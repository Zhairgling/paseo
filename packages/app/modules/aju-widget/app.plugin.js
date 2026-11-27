const fs = require("node:fs");
const path = require("node:path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  withStringsXml,
} = require("expo/config-plugins");

const PACKAGE_LIST = "PackageList(this).packages.apply {";
const WIDGET_PACKAGE_REGISTRATION = "add(sh.paseo.widget.AjuCodeWidgetPackage())";
const WIDGET_RECEIVER_NAME = ".widget.AjuCodeWidgetProvider";

const WIDGET_STRINGS = [
  { name: "ajucode_widget_name", value: "AjuCode Sessions" },
  {
    name: "ajucode_widget_description",
    value: "Sessions en cours, permissions et derniers messages en attente",
  },
];

function configureWidgetMainApplication(contents) {
  if (contents.includes(WIDGET_PACKAGE_REGISTRATION)) {
    return contents;
  }
  if (!contents.includes(PACKAGE_LIST)) {
    throw new Error("Could not register AjuCodeWidgetPackage in MainApplication PackageList block");
  }
  return contents.replace(
    PACKAGE_LIST,
    `${PACKAGE_LIST}\n              ${WIDGET_PACKAGE_REGISTRATION}`,
  );
}

function configureWidgetManifest(manifest) {
  const application = manifest.application?.[0];
  if (!application) {
    throw new Error(
      "Could not register Android widget receiver without an application manifest entry",
    );
  }

  const receivers = (application.receiver ??= []);
  const receiverEntry = {
    $: {
      "android:name": WIDGET_RECEIVER_NAME,
      "android:exported": "true",
      "android:label": "@string/ajucode_widget_name",
    },
    "intent-filter": [
      {
        action: [
          {
            $: {
              "android:name": "android.appwidget.action.APPWIDGET_UPDATE",
            },
          },
        ],
      },
    ],
    "meta-data": [
      {
        $: {
          "android:name": "android.appwidget.provider",
          "android:resource": "@xml/ajucode_widget_info",
        },
      },
    ],
  };

  const existingIndex = receivers.findIndex(
    (receiver) => receiver.$?.["android:name"] === WIDGET_RECEIVER_NAME,
  );
  if (existingIndex >= 0) {
    receivers[existingIndex] = receiverEntry;
  } else {
    receivers.push(receiverEntry);
  }
  return manifest;
}

function configureWidgetStrings(stringsXml) {
  return AndroidConfig.Strings.setStringItem(
    WIDGET_STRINGS.map((item) => ({
      $: { name: item.name },
      _: item.value,
    })),
    stringsXml,
  );
}

function copyWidgetNativeAssets(platformProjectRoot, moduleRoot = __dirname) {
  const sourceAndroidDir = path.join(moduleRoot, "android");
  fs.cpSync(sourceAndroidDir, platformProjectRoot, { recursive: true, force: true });
}

function withAjuWidget(config) {
  config = withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents = configureWidgetMainApplication(modConfig.modResults.contents);
    return modConfig;
  });

  config = withAndroidManifest(config, (modConfig) => {
    modConfig.modResults.manifest = configureWidgetManifest(modConfig.modResults.manifest);
    return modConfig;
  });

  config = withStringsXml(config, (modConfig) => {
    modConfig.modResults = configureWidgetStrings(modConfig.modResults);
    return modConfig;
  });

  config = withDangerousMod(config, [
    "android",
    (modConfig) => {
      copyWidgetNativeAssets(modConfig.modRequest.platformProjectRoot, __dirname);
      return modConfig;
    },
  ]);

  return config;
}

module.exports = withAjuWidget;
module.exports.configureWidgetMainApplication = configureWidgetMainApplication;
module.exports.configureWidgetManifest = configureWidgetManifest;
module.exports.configureWidgetStrings = configureWidgetStrings;
module.exports.copyWidgetNativeAssets = copyWidgetNativeAssets;
