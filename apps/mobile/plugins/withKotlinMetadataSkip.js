const { withProjectBuildGradle } = require('@expo/config-plugins');

// react-native-google-mobile-ads pulls play-services-ads 25.x, which is compiled
// with Kotlin 2.3 metadata. Expo SDK 54 maxes out at Kotlin 2.2.20, so the
// compiler rejects it ("Module was compiled with an incompatible version of
// Kotlin"). `-Xskip-metadata-version-check` relaxes that gate so the 2.2.20
// compiler can still read the (one-minor-newer) metadata. Applied to every
// subproject's Kotlin compile via the root build.gradle.
const MARKER = '-Xskip-metadata-version-check';
const SNIPPET = `

// daidoko: allow consuming libs compiled with a slightly newer Kotlin
// (play-services-ads 25.x / Kotlin 2.3 metadata vs project Kotlin 2.2.20).
allprojects {
    tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
        kotlinOptions {
            freeCompilerArgs += ["-Xskip-metadata-version-check"]
        }
    }
}
`;

module.exports = function withKotlinMetadataSkip(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') return cfg;
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += SNIPPET;
    }
    return cfg;
  });
};
