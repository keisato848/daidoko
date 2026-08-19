/**
 * react-native-keyboard-controller はネイティブモジュールを持つので、
 * jest では同梱のモック（`react-native-keyboard-controller/jest`）に差し替える。
 * 素で読むと NativeEventEmitter の登録で「rebuild the app」と言われて落ちる。
 */
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);
