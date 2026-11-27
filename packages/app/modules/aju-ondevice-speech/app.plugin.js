const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { withProjectBuildGradle } = require("expo/config-plugins");

const SHERPA_VERSION = "2.0.3";
const SHERPA_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/sherpa-onnx-${SHERPA_VERSION}.aar`;
const MAVEN_MARKER = "../modules/aju-ondevice-speech/android/maven";

function ensureSherpaAar(moduleRoot) {
  const mavenAarPath = path.join(
    moduleRoot,
    "android",
    "maven",
    "com",
    "k2fsa",
    "sherpa",
    "sherpa-onnx",
    SHERPA_VERSION,
    `sherpa-onnx-${SHERPA_VERSION}.aar`,
  );
  if (fs.existsSync(mavenAarPath) && fs.statSync(mavenAarPath).size > 10_000_000) {
    return;
  }

  fs.mkdirSync(path.dirname(mavenAarPath), { recursive: true });
  const cachePath = path.join(
    os.homedir(),
    ".cache",
    "ajucode-sherpa",
    `sherpa-onnx-${SHERPA_VERSION}.aar`,
  );
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 10_000_000) {
    fs.copyFileSync(cachePath, mavenAarPath);
    return;
  }

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  execFileSync("curl", ["-fsSL", "-o", cachePath, SHERPA_URL], { stdio: "inherit" });
  fs.copyFileSync(cachePath, mavenAarPath);
}

function configureRootBuildGradle(contents) {
  if (contents.includes(MAVEN_MARKER)) {
    return contents;
  }
  const anchor = "maven { url 'https://www.jitpack.io' }";
  if (!contents.includes(anchor)) {
    throw new Error(
      "Could not register aju-ondevice-speech maven repository in android/build.gradle",
    );
  }
  return contents.replace(
    anchor,
    `${anchor}\n    maven { url = uri(new File(rootProject.projectDir, "${MAVEN_MARKER}").toURI()) }`,
  );
}

module.exports = function withAjuOnDeviceSpeech(config) {
  return withProjectBuildGradle(config, (modConfig) => {
    if (!modConfig.modRequest.introspect) {
      ensureSherpaAar(__dirname);
    }
    modConfig.modResults.contents = configureRootBuildGradle(modConfig.modResults.contents);
    return modConfig;
  });
};

module.exports.configureRootBuildGradle = configureRootBuildGradle;
