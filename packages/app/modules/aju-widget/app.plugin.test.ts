import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const widgetPlugin = require("./app.plugin");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("aju-widget Expo plugin", () => {
  it("registers AjuCodeWidgetPackage idempotently in MainApplication", () => {
    const sampleMainApplication = `
class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(0, sh.paseo.scroll.PaseoScrollPackage())
        }
    )
  }
}
`;
    const once = widgetPlugin.configureWidgetMainApplication(sampleMainApplication);
    expect(once).toContain("add(sh.paseo.widget.AjuCodeWidgetPackage())");
    expect(widgetPlugin.configureWidgetMainApplication(once)).toBe(once);
  });

  it("registers the widget receiver once in AndroidManifest", () => {
    const manifest = { application: [{ $: { "android:name": ".MainApplication" } }] };
    widgetPlugin.configureWidgetManifest(manifest);
    widgetPlugin.configureWidgetManifest(manifest);

    const receivers = (manifest.application[0] as { receiver?: unknown[] }).receiver ?? [];
    expect(receivers).toHaveLength(1);
    expect(receivers[0]).toMatchObject({
      $: {
        "android:name": ".widget.AjuCodeWidgetProvider",
        "android:exported": "true",
        "android:label": "@string/ajucode_widget_name",
      },
    });
  });

  it("sets widget label and description strings idempotently", () => {
    const stringsXml = { resources: { string: [{ $: { name: "app_name" }, _: "AjuCode" }] } };
    const updated = widgetPlugin.configureWidgetStrings(stringsXml);
    const updatedAgain = widgetPlugin.configureWidgetStrings(updated);

    expect(updatedAgain.resources.string).toEqual(
      expect.arrayContaining([
        { $: { name: "app_name" }, _: "AjuCode" },
        { $: { name: "ajucode_widget_name" }, _: "AjuCode Sessions" },
        {
          $: { name: "ajucode_widget_description" },
          _: "Sessions en cours, permissions et derniers messages en attente",
        },
      ]),
    );
  });

  it("copies all native widget Kotlin and XML files into the Android project", () => {
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aju-widget-test-"));
    tempDirs.push(targetRoot);

    widgetPlugin.copyWidgetNativeAssets(targetRoot);

    expect(
      fs.existsSync(
        path.join(targetRoot, "app/src/main/java/sh/paseo/widget/AjuCodeWidgetProvider.kt"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(targetRoot, "app/src/main/java/sh/paseo/widget/AjuCodeWidgetModule.kt"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(targetRoot, "app/src/main/java/sh/paseo/widget/AjuCodeWidgetPackage.kt"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(targetRoot, "app/src/main/res/layout/ajucode_widget.xml"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(targetRoot, "app/src/main/res/xml/ajucode_widget_info.xml")),
    ).toBe(true);
    expect(fs.existsSync(path.join(targetRoot, "app/src/main/res/drawable/widget_bg.xml"))).toBe(
      true,
    );
  });
});
