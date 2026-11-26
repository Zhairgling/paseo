#!/usr/bin/env node
/**
 * Golden Tests visuels multi-appareils pour Paseo Atelier.
 *
 * Appareils cibles :
 * - Desktop 1440x900
 * - Honor Pad 10 (2560x1600 @ DPR 2 -> 1280x800 paysage & 800x1280 portrait)
 * - Honor Magic V6 déplié (2352x2172 @ DPR 3 -> 784x724, usage principal)
 * - Honor Magic V6 plié (1080x2420 @ DPR 3 -> 360x807)
 *
 * Usage :
 *   node scripts/golden-visual.mjs            # Compare contre packages/app/e2e/golden/baselines/
 *   node scripts/golden-visual.mjs --update   # Met à jour les captures de référence
 *   node scripts/golden-visual.mjs --live --out /chemin/dossier  # Capture avec un snapshot read-only de ~/.paseo
 */

import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const GOLDEN_DIR = path.join(REPO_ROOT, "packages", "app", "e2e", "golden");
const BASELINES_DIR = path.join(GOLDEN_DIR, "baselines");
const DIFFS_DIR = path.join(GOLDEN_DIR, "diffs");

const args = new Set(process.argv.slice(2));
const UPDATE_MODE = args.has("--update");
const LIVE_MODE = args.has("--live");
const outIdx = process.argv.indexOf("--out");
const CUSTOM_OUT_DIR = outIdx >= 0 ? process.argv[outIdx + 1] : null;

const MAX_DIFF_RATIO = 0.015; // 1.5 % de tolérance anti-aliasing/polices
const PORT = Number.parseInt(process.env.PASEO_GOLDEN_PORT ?? "16769", 10);

export const DEVICE_PROFILES = [
  {
    id: "desktop-1440x900",
    label: "Desktop 1440×900",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
  },
  {
    id: "honor-pad-10-landscape",
    label: "Honor Pad 10 Paysage (2560×1600 @2x)",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    isMobile: false,
  },
  {
    id: "honor-pad-10-portrait",
    label: "Honor Pad 10 Portrait (1600×2560 @2x)",
    viewport: { width: 800, height: 1280 },
    deviceScaleFactor: 2,
    isMobile: true,
  },
  {
    id: "honor-magic-v6-unfolded",
    label: "Honor Magic V6 Déplié (2352×2172 @3x)",
    viewport: { width: 784, height: 724 },
    deviceScaleFactor: 3,
    isMobile: true,
  },
  {
    id: "honor-magic-v6-folded",
    label: "Honor Magic V6 Plié (1080×2420 @3x)",
    viewport: { width: 360, height: 807 },
    deviceScaleFactor: 3,
    isMobile: true,
  },
];

async function findChromiumExecutable() {
  const cacheDir = path.join(os.homedir(), ".cache", "ms-playwright");
  const entries = await readdir(cacheDir).catch(() => []);
  for (const name of entries.sort().reverse()) {
    if (!name.startsWith("chromium-")) continue;
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const candidate = path.join(cacheDir, name, sub);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Continuer la recherche
      }
    }
  }
  return undefined;
}

async function seedDeterministicHome(tmpHome) {
  const now = Date.now();
  const projectsDir = path.join(tmpHome, "projects");
  const agentsBase = path.join(tmpHome, "agents");
  await mkdir(projectsDir, { recursive: true });
  await mkdir(agentsBase, { recursive: true });

  const fixtureRepos = [
    { id: "prj_miband8", name: "miBand8", cwd: "/tmp/golden/miBand8", wks: "wks_miband8" },
    { id: "prj_bikeplan", name: "bikeplan", cwd: "/tmp/golden/bikeplan", wks: "wks_bikeplan" },
    { id: "prj_minimoto", name: "minimoto", cwd: "/tmp/golden/minimoto", wks: "wks_minimoto" },
    { id: "prj_echo", name: "echo-libre", cwd: "/tmp/golden/echo-libre", wks: "wks_echo" },
  ];

  for (const repo of fixtureRepos) {
    await mkdir(repo.cwd, { recursive: true });
  }

  await writeFile(
    path.join(projectsDir, "projects.json"),
    JSON.stringify(
      fixtureRepos.map((r) => ({
        projectId: r.id,
        rootPath: r.cwd,
        kind: "git",
        displayName: r.name,
        projectKey: `local:${r.cwd}`,
        customName: null,
        customIconRevision: null,
        createdAt: new Date(now - 86_400_000).toISOString(),
        updatedAt: new Date(now - 86_400_000).toISOString(),
        archivedAt: null,
      })),
      null,
      2,
    ),
  );

  await writeFile(
    path.join(projectsDir, "workspaces.json"),
    JSON.stringify(
      fixtureRepos.map((r, idx) => ({
        workspaceId: r.wks,
        projectId: r.id,
        cwd: r.cwd,
        kind: "local_checkout",
        displayName: idx === 0 ? "feat/ota-ble" : "main",
        title: null,
        branch: idx === 0 ? "feat/ota-ble" : "main",
        worktreeRoot: r.cwd,
        baseBranch: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
        createdAt: new Date(now - 86_400_000).toISOString(),
        updatedAt: new Date(now - idx * 600_000).toISOString(),
        archivedAt: null,
        autoArchivedChangeRequestUrl: null,
        pinnedAt: idx === 0 ? new Date(now - 3_600_000).toISOString() : null,
        metadata: {},
        background: false,
      })),
      null,
      2,
    ),
  );

  const fixtureAgents = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "OTA Mi Band 8 — Analyse bootloader",
      provider: "opencode",
      model: "mac/qwen3.8-27b-abliterated",
      cwd: "/tmp/golden/miBand8",
      wks: "wks_miband8",
      status: "idle",
      offsetMs: 120_000,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Dossier vélo cargo — Kit graphique Atelier",
      provider: "antigravity",
      model: "gemini-4-neon",
      cwd: "/tmp/golden/bikeplan",
      wks: "wks_bikeplan",
      status: "idle",
      offsetMs: 480_000,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      title: "Minimoto — Géométrie suspension & cadre",
      provider: "claude",
      model: "claude-opus-5-5",
      cwd: "/tmp/golden/minimoto",
      wks: "wks_minimoto",
      status: "idle",
      offsetMs: 3_600_000,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      title: "Satellite Echo Rust (wake word)",
      provider: "antigravity",
      model: "gemini-4-hydrogen",
      cwd: "/tmp/golden/echo-libre",
      wks: "wks_echo",
      status: "idle",
      offsetMs: 7_200_000,
    },
  ];

  for (const ag of fixtureAgents) {
    const slug = ag.cwd.replace(/^\//, "").replace(/\//g, "-");
    const dir = path.join(agentsBase, slug);
    await mkdir(dir, { recursive: true });
    const ts = new Date(now - ag.offsetMs).toISOString();
    await writeFile(
      path.join(dir, `${ag.id}.json`),
      JSON.stringify(
        {
          id: ag.id,
          provider: ag.provider,
          cwd: ag.cwd,
          workspaceId: ag.wks,
          createdAt: ts,
          updatedAt: ts,
          lastActivityAt: ts,
          lastUserMessageAt: ts,
          title: ag.title,
          labels: {},
          metadata: {},
          lastStatus: ag.status,
          lastModeId: "default",
          config: { modeId: "default", model: ag.model },
          runtimeInfo: { provider: ag.provider, model: ag.model, modeId: "default" },
          controls: [],
          requiresAttention: false,
          attentionReason: null,
          attentionTimestamp: null,
          internal: false,
        },
        null,
        2,
      ),
    );
  }
}

async function comparePngBuffers(page, baselineBuf, currentBuf) {
  const b64A = baselineBuf.toString("base64");
  const b64B = currentBuf.toString("base64");
  return await page.evaluate(
    async ({ a, b }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${src}`;
        });
      const [imgA, imgB] = await Promise.all([load(a), load(b)]);
      const width = Math.max(imgA.width, imgB.width);
      const height = Math.max(imgA.height, imgB.height);
      const cA = document.createElement("canvas");
      const cB = document.createElement("canvas");
      const cD = document.createElement("canvas");
      cA.width = cB.width = cD.width = width;
      cA.height = cB.height = cD.height = height;
      const ctxA = cA.getContext("2d");
      const ctxB = cB.getContext("2d");
      const ctxD = cD.getContext("2d");
      ctxA.drawImage(imgA, 0, 0);
      ctxB.drawImage(imgB, 0, 0);
      const dA = ctxA.getImageData(0, 0, width, height).data;
      const dB = ctxB.getImageData(0, 0, width, height).data;
      const out = ctxD.createImageData(width, height);
      let diffPixels = 0;
      const total = width * height;
      for (let i = 0; i < dA.length; i += 4) {
        const dr = Math.abs(dA[i] - dB[i]);
        const dg = Math.abs(dA[i + 1] - dB[i + 1]);
        const db = Math.abs(dA[i + 2] - dB[i + 2]);
        const da = Math.abs(dA[i + 3] - dB[i + 3]);
        if (dr + dg + db + da > 24) {
          diffPixels += 1;
          out.data[i] = 240;
          out.data[i + 1] = 80;
          out.data[i + 2] = 60;
          out.data[i + 3] = 255;
        } else {
          out.data[i] = Math.round(dB[i] * 0.35);
          out.data[i + 1] = Math.round(dB[i + 1] * 0.35);
          out.data[i + 2] = Math.round(dB[i + 2] * 0.35);
          out.data[i + 3] = 255;
        }
      }
      ctxD.putImageData(out, 0, 0);
      return {
        ratio: total > 0 ? diffPixels / total : 0,
        diffPixels,
        total,
        sizeMismatch: imgA.width !== imgB.width || imgA.height !== imgB.height,
        diffDataUrl: cD.toDataURL("image/png"),
      };
    },
    { a: b64A, b: b64B },
  );
}

async function run() {
  const tmpHome = await mkdtemp(path.join(os.tmpdir(), "paseo-golden-"));
  if (LIVE_MODE) {
    const realHome = path.join(os.homedir(), ".paseo");
    for (const sub of ["agents", "projects"]) {
      await cp(path.join(realHome, sub), path.join(tmpHome, sub), { recursive: true }).catch(
        () => {},
      );
    }
  } else {
    await seedDeterministicHome(tmpHome);
  }

  const daemon = spawn("node", ["packages/cli/bin/paseo", "daemon", "run", "--home", tmpHome], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PASEO_HOME: tmpHome,
      PASEO_LISTEN: `127.0.0.1:${PORT}`,
      PASEO_WEB_UI_ENABLED: "true",
      PASEO_RELAY_ENABLED: "false",
    },
    stdio: "pipe",
  });

  let browser;
  const failures = [];

  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // Attente démarrage daemon
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) throw new Error(`Daemon golden non prêt sur :${PORT}`);

    const execPath = await findChromiumExecutable();
    browser = await chromium.launch({ executablePath: execPath, headless: true });

    const outDir = CUSTOM_OUT_DIR ?? BASELINES_DIR;
    await mkdir(outDir, { recursive: true });
    if (!UPDATE_MODE && !LIVE_MODE) {
      await mkdir(DIFFS_DIR, { recursive: true });
    }

    const helperCtx = await browser.newContext();
    const helperPage = await helperCtx.newPage();
    await helperPage.setContent("<!doctype html><html><body></body></html>");

    for (const profile of DEVICE_PROFILES) {
      const ctx = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: profile.deviceScaleFactor,
        isMobile: profile.isMobile,
        locale: "fr-FR",
      });
      const page = await ctx.newPage();

      // 1. Vue Inbox « Toutes les sessions »
      await page.goto(`http://127.0.0.1:${PORT}/inbox`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1800);
      // Fermer le wizard d'accueil si affiché sur un contexte navigateur vierge
      const skipSetup = page.getByText(/Passer la configuration|Skip setup/i);
      if (
        await skipSetup
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        await skipSetup.first().click();
        await page.waitForTimeout(600);
      }
      const inboxBuf = await page.screenshot();
      await verifyOrSave(helperPage, `${profile.id}__inbox.png`, inboxBuf, outDir, failures);

      // 2. Sidebar avec « Épinglés » + « Dernières sessions » + « Workspaces » replié
      const menuBtn = page.locator('[data-testid="menu-button"]').first();
      const menuExpanded = await menuBtn.getAttribute("aria-expanded").catch(() => null);
      if (menuExpanded === "false" && (await menuBtn.isVisible().catch(() => false))) {
        await menuBtn.click();
        await page.waitForTimeout(700);
      }
      const wksHeader = page.locator('[data-testid="sidebar-workspaces-section-header"]').first();
      if (await wksHeader.isVisible().catch(() => false)) {
        await wksHeader.click();
        await page.waitForTimeout(500);
      }
      const collapsedBuf = await page.screenshot();
      await verifyOrSave(
        helperPage,
        `${profile.id}__sidebar-collapsed.png`,
        collapsedBuf,
        outDir,
        failures,
      );

      await ctx.close();
    }

    await helperCtx.close();

    if (failures.length > 0) {
      console.error(`\n❌ ${failures.length} échec(s) golden test :\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log(`\n✅ Golden tests OK (${DEVICE_PROFILES.length * 2} captures vérifiées).`);
    }
  } finally {
    if (browser) await browser.close();
    daemon.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
    await rm(tmpHome, { recursive: true, force: true });
  }
}

async function verifyOrSave(helperPage, fileName, buf, outDir, failures) {
  if (UPDATE_MODE || LIVE_MODE) {
    const dest = path.join(outDir, fileName);
    await writeFile(dest, buf);
    console.log(`📸 ${LIVE_MODE ? "Live" : "Baseline"} : ${fileName}`);
    return;
  }

  const baselinePath = path.join(BASELINES_DIR, fileName);
  let baselineBuf;
  try {
    baselineBuf = await readFile(baselinePath);
  } catch {
    failures.push(`${fileName} : baseline manquante (lancer npm run test:golden:update)`);
    return;
  }

  const cmp = await comparePngBuffers(helperPage, baselineBuf, buf);
  const pct = (cmp.ratio * 100).toFixed(2);
  if (cmp.sizeMismatch || cmp.ratio > MAX_DIFF_RATIO) {
    const diffImg = Buffer.from(cmp.diffDataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
    await writeFile(path.join(DIFFS_DIR, fileName), diffImg);
    failures.push(`${fileName} : écart ${pct}% > ${(MAX_DIFF_RATIO * 100).toFixed(1)}%`);
    console.log(`❌ ${fileName} : ${pct}% diff (diff enregistré)`);
  } else {
    console.log(`✅ ${fileName} : ${pct}% diff`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
