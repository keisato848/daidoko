// @testing-library/react-native の waitFor 既定 1 秒は、react-native の jest モックが
// ScrollView / Modal / Animated を「最初に描画したとき」に遅延ロードするコスト
// （Windows 実測: ScrollView 1.9 秒 + 残り 1.1 秒 = 初回 waitFor 3.6 秒。jest キャッシュが冷えていると 5 秒超）を吸収できない。
// suite の 1 本目だけが赤くなる形で出る。docs/品質基準.md §2.3（2026-09-09 の項）。
const { configure } = require('@testing-library/react-native');

configure({ asyncUtilTimeout: 10000 });
