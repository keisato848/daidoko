const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ML_KIT_DEPENDENCY = 'implementation("com.google.mlkit:text-recognition-japanese:16.0.1")';
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
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions

class DaidokoOcrModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val recognizer by lazy {
    TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(true)
  }

  @ReactMethod
  fun recognizeImage(imageUri: String, promise: Promise) {
    try {
      val image = InputImage.fromFilePath(reactContext, Uri.parse(imageUri))
      recognizer.process(image)
        .addOnSuccessListener { text -> promise.resolve(toWritableMap(text)) }
        .addOnFailureListener { error ->
          promise.reject("OCR_FAILED", error.message ?: "Text recognition failed", error)
        }
    } catch (error: Exception) {
      promise.reject("OCR_INPUT_FAILED", error.message ?: "Invalid OCR image", error)
    }
  }

  private fun toWritableMap(text: Text): WritableMap {
    val result = Arguments.createMap()
    result.putString("rawText", text.text)
    result.putArray("blocks", toBlocks(text.textBlocks))
    result.putString("confidence", inferConfidence(text.text))
    result.putArray("warnings", buildWarnings(text.text))
    return result
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
    val length = rawText.replace(Regex("\\s"), "").length
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

function withDaidokoOcrBuildGradle(config) {
  return withAppBuildGradle(config, (configWithGradle) => {
    if (!configWithGradle.modResults.contents.includes(ML_KIT_DEPENDENCY)) {
      configWithGradle.modResults.contents = configWithGradle.modResults.contents.replace(
        '    implementation("com.facebook.react:react-android")',
        `    implementation("com.facebook.react:react-android")\n    ${ML_KIT_DEPENDENCY}`,
      );
    }
    return configWithGradle;
  });
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
  config = withDaidokoOcrBuildGradle(config);
  config = withDaidokoOcrMainApplication(config);
  config = withDaidokoOcrSources(config);
  return config;
};
