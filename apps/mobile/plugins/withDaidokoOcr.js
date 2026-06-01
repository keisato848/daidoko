const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ML_KIT_DEPENDENCIES = [
  'implementation("com.google.mlkit:text-recognition-japanese:16.0.1")',
  'implementation("com.google.mlkit:image-labeling:17.0.9")',
];
const ANDROID_BUILD_PROPERTIES = {
  'android.compileSdkVersion': '35',
  'android.targetSdkVersion': '35',
  'android.suppressUnsupportedCompileSdk': '35',
};
const PLAY_SIGNING_SETUP = `
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('keystore.properties')
if (keystorePropertiesFile.exists()) {
  keystorePropertiesFile.withInputStream { stream ->
    keystoreProperties.load(stream)
  }
}

def propOrEnv = { name ->
  def value = findProperty(name) ?: keystoreProperties.getProperty(name) ?: System.getenv(name)
  value == null ? null : value.toString().trim()
}

def uploadStoreFilePath = propOrEnv('DAIDOKO_UPLOAD_STORE_FILE')
def uploadStorePassword = propOrEnv('DAIDOKO_UPLOAD_STORE_PASSWORD')
def uploadKeyAlias = propOrEnv('DAIDOKO_UPLOAD_KEY_ALIAS')
def uploadKeyPassword = propOrEnv('DAIDOKO_UPLOAD_KEY_PASSWORD')
def hasUploadSigning = [uploadStoreFilePath, uploadStorePassword, uploadKeyAlias, uploadKeyPassword].every { it }

gradle.taskGraph.whenReady { taskGraph ->
  def bundlesRelease = taskGraph.allTasks.any { it.path == ':app:bundleRelease' || it.name == 'bundleRelease' }
  if (bundlesRelease && !hasUploadSigning) {
    throw new RuntimeException('Google Play bundleRelease requires DAIDOKO_UPLOAD_STORE_FILE, DAIDOKO_UPLOAD_STORE_PASSWORD, DAIDOKO_UPLOAD_KEY_ALIAS, and DAIDOKO_UPLOAD_KEY_PASSWORD. Set them as environment variables or in apps/mobile/android/keystore.properties.')
  }
}
`;
const PLAY_RELEASE_SIGNING_CONFIG = `
    if (hasUploadSigning) {
      release {
        storeFile rootProject.file(uploadStoreFilePath)
        storePassword uploadStorePassword
        keyAlias uploadKeyAlias
        keyPassword uploadKeyPassword
      }
    }`;
const OCR_IMPORT = 'import com.daidoko.app.ocr.DaidokoOcrPackage';
const OCR_PACKAGE_REGISTRATION = '            packages.add(DaidokoOcrPackage())';

const OCR_PACKAGE_SOURCE = `package com.daidoko.app.ocr

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DaidokoOcrPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(DaidokoOcrModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
`;

const OCR_MODULE_SOURCE = `package com.daidoko.app.ocr

import android.graphics.BitmapFactory
import android.graphics.Rect
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabel
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions

class DaidokoOcrModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val recognizer by lazy {
    TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
  }
  private val imageLabeler by lazy {
    ImageLabeling.getClient(ImageLabelerOptions.DEFAULT_OPTIONS)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(true)
  }

  @ReactMethod
  fun recognizeImage(imageUri: String, promise: Promise) {
    try {
      val image = createInputImage(imageUri)
      recognizer.process(image)
        .addOnSuccessListener { text -> promise.resolve(toWritableMap(text)) }
        .addOnFailureListener { error ->
          promise.reject("OCR_FAILED", error.message ?: "Text recognition failed", error)
        }
    } catch (error: Exception) {
      promise.reject("OCR_INPUT_FAILED", error.message ?: "Invalid OCR image", error)
    }
  }

  @ReactMethod
  fun labelImage(imageUri: String, promise: Promise) {
    try {
      val image = createInputImage(imageUri)
      imageLabeler.process(image)
        .addOnSuccessListener { labels -> promise.resolve(toLabelArray(labels)) }
        .addOnFailureListener { error ->
          promise.reject("IMAGE_LABEL_FAILED", error.message ?: "Image labeling failed", error)
        }
    } catch (error: Exception) {
      promise.reject("IMAGE_LABEL_INPUT_FAILED", error.message ?: "Invalid image", error)
    }
  }

  private fun createInputImage(imageUri: String): InputImage {
    val uri = Uri.parse(imageUri)
    if (uri.scheme == "asset" || (uri.scheme == null && imageUri.startsWith("assets_"))) {
      val assetPath = uri.path?.trimStart('/')?.takeIf { it.isNotBlank() }
        ?: imageUri.removePrefix("asset:/").trimStart('/')
      val bitmap = decodeBundledBitmap(assetPath)
      return InputImage.fromBitmap(bitmap, 0)
    }
    return InputImage.fromFilePath(reactContext, uri)
  }

  private fun decodeBundledBitmap(assetPath: String) =
    decodeAssetBitmap(assetPath)
      ?: decodeDrawableBitmap(assetPath)
      ?: throw IllegalArgumentException("Could not decode bundled OCR asset: $assetPath")

  private fun decodeAssetBitmap(assetPath: String) = buildList {
    add(assetPath)
    if (!assetPath.endsWith(".png")) add("$assetPath.png")
  }.firstNotNullOfOrNull { candidate ->
    runCatching {
      reactContext.assets.open(candidate).use { stream -> BitmapFactory.decodeStream(stream) }
    }.getOrNull()
  }

  private fun decodeDrawableBitmap(assetPath: String) =
    assetPath.substringAfterLast('/').substringBeforeLast('.').takeIf { it.isNotBlank() }?.let { name ->
      val resourceId = reactContext.resources.getIdentifier(name, "drawable", reactContext.packageName)
      if (resourceId == 0) null else BitmapFactory.decodeResource(reactContext.resources, resourceId)
    }

  private fun toWritableMap(text: Text): WritableMap {
    val result = Arguments.createMap()
    result.putString("rawText", text.text)
    result.putArray("blocks", toBlocks(text.textBlocks))
    result.putString("confidence", inferConfidence(text.text))
    result.putArray("warnings", buildWarnings(text.text))
    return result
  }

  private fun toLabelArray(labels: List<ImageLabel>): WritableArray {
    val array = Arguments.createArray()
    labels.forEach { label ->
      val map = Arguments.createMap()
      map.putString("text", label.text)
      map.putDouble("confidence", label.confidence.toDouble())
      map.putInt("index", label.index)
      array.pushMap(map)
    }
    return array
  }

  private fun toBlocks(blocks: List<Text.TextBlock>): WritableArray {
    val array = Arguments.createArray()
    blocks.forEach { block ->
      val blockMap = Arguments.createMap()
      blockMap.putString("text", block.text)
      blockMap.putArray("lines", toLines(block.lines))
      array.pushMap(blockMap)
    }
    return array
  }

  private fun toLines(lines: List<Text.Line>): WritableArray {
    val array = Arguments.createArray()
    lines.forEach { line ->
      val lineMap = Arguments.createMap()
      lineMap.putString("text", line.text)
      line.boundingBox?.let { lineMap.putMap("boundingBox", toBoundingBox(it)) }
      array.pushMap(lineMap)
    }
    return array
  }

  private fun toBoundingBox(rect: Rect): WritableMap {
    val map = Arguments.createMap()
    map.putInt("x", rect.left)
    map.putInt("y", rect.top)
    map.putInt("width", rect.width())
    map.putInt("height", rect.height())
    return map
  }

  private fun inferConfidence(rawText: String): String {
    val length = rawText.replace(Regex("\\\\s"), "").length
    return when {
      length >= 80 -> "high"
      length >= 20 -> "medium"
      else -> "low"
    }
  }

  private fun buildWarnings(rawText: String): WritableArray {
    val warnings = Arguments.createArray()
    if (rawText.isBlank()) warnings.pushString("文字を読み取れませんでした")
    return warnings
  }

  companion object {
    const val NAME = "DaidokoOcr"
  }
}
`;

function ensureManifestPermission(manifest, permissionName) {
  const usesPermission = manifest['uses-permission'] ?? [];
  if (!usesPermission.some((permission) => permission.$?.['android:name'] === permissionName)) {
    usesPermission.push({ $: { 'android:name': permissionName } });
  }
  manifest['uses-permission'] = usesPermission;
}

function withDaidokoOcrManifest(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    ensureManifestPermission(manifest, 'android.permission.CAMERA');
    ensureManifestPermission(manifest, 'android.permission.READ_MEDIA_IMAGES');
    return configWithManifest;
  });
}

function upsertGradleProperty(modResults, key, value) {
  const existingProperty = modResults.find(
    (item) => item.type === 'property' && item.key === key,
  );
  if (existingProperty) {
    existingProperty.value = value;
  } else {
    modResults.push({ type: 'property', key, value });
  }
  return modResults;
}

function withDaidokoAndroidBuildProperties(config) {
  return withGradleProperties(config, (configWithGradleProperties) => {
    let { modResults } = configWithGradleProperties;
    for (const [key, value] of Object.entries(ANDROID_BUILD_PROPERTIES)) {
      modResults = upsertGradleProperty(modResults, key, value);
    }
    configWithGradleProperties.modResults = modResults;
    return configWithGradleProperties;
  });
}

function withDaidokoOcrBuildGradle(config) {
  return withAppBuildGradle(config, (configWithGradle) => {
    let contents = configWithGradle.modResults.contents;
    for (const dependency of ML_KIT_DEPENDENCIES) {
      if (!contents.includes(dependency)) {
        contents = contents.replace(
          '    implementation("com.facebook.react:react-android")',
          `    implementation("com.facebook.react:react-android")\n    ${dependency}`,
        );
      }
    }
    contents = withDaidokoPlaySigning(contents);
    configWithGradle.modResults.contents = contents;
    return configWithGradle;
  });
}

function withDaidokoPlaySigning(contents) {
  if (!contents.includes("def uploadStoreFilePath = propOrEnv('DAIDOKO_UPLOAD_STORE_FILE')")) {
    contents = contents.replace(
      'def rnVersion = getRNVersion()\n',
      `def rnVersion = getRNVersion()\n${PLAY_SIGNING_SETUP}\n`,
    );
  }
  if (!contents.includes('storeFile rootProject.file(uploadStoreFilePath)')) {
    contents = contents.replace(
      `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`,
      `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }${PLAY_RELEASE_SIGNING_CONFIG}`,
    );
  }
  return contents.replace(
    'signingConfig signingConfigs.debug\n            shrinkResources',
    'signingConfig hasUploadSigning ? signingConfigs.release : signingConfigs.debug\n            shrinkResources',
  );
}

function withDaidokoOcrMainApplication(config) {
  return withMainApplication(config, (configWithMainApplication) => {
    let contents = configWithMainApplication.modResults.contents;
    if (!contents.includes(OCR_IMPORT)) {
      contents = contents.replace(
        'import com.daidoko.app.llm.DaidokoRecipeTextLlmPackage',
        `import com.daidoko.app.llm.DaidokoRecipeTextLlmPackage\n${OCR_IMPORT}`,
      );
    }
    if (!contents.includes(OCR_PACKAGE_REGISTRATION)) {
      contents = contents.replace(
        '            packages.add(DaidokoRecipeTextLlmPackage())',
        `            packages.add(DaidokoRecipeTextLlmPackage())\n${OCR_PACKAGE_REGISTRATION}`,
      );
    }
    configWithMainApplication.modResults.contents = contents;
    return configWithMainApplication;
  });
}

function withDaidokoOcrSources(config) {
  return withDangerousMod(config, [
    'android',
    async (configWithAndroid) => {
      const ocrDir = path.join(
        configWithAndroid.modRequest.platformProjectRoot,
        'app/src/main/java/com/daidoko/app/ocr',
      );
      await fs.promises.mkdir(ocrDir, { recursive: true });
      await fs.promises.writeFile(path.join(ocrDir, 'DaidokoOcrPackage.kt'), OCR_PACKAGE_SOURCE);
      await fs.promises.writeFile(path.join(ocrDir, 'DaidokoOcrModule.kt'), OCR_MODULE_SOURCE);
      return configWithAndroid;
    },
  ]);
}

module.exports = function withDaidokoOcr(config) {
  config = withDaidokoOcrManifest(config);
  config = withDaidokoAndroidBuildProperties(config);
  config = withDaidokoOcrBuildGradle(config);
  config = withDaidokoOcrMainApplication(config);
  config = withDaidokoOcrSources(config);
  return config;
};
