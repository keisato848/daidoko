module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 の worklet 変換。**入れないと起動時に落ちる**
    // （`Exception in HostObject::get for prop 'ReanimatedModule'`）。
    // 4 でプラグインは react-native-worklets 側へ移った（3 までは
    // `react-native-reanimated/plugin`）。**必ずプラグイン配列の最後**に置く。
    // 直接 Reanimated は使っていないが、react-native-keyboard-controller が内部で使う。
    plugins: ['react-native-worklets/plugin'],
  };
};
