Pod::Spec.new do |s|
  s.name           = 'DaidokoWidgetStorage'
  s.version        = '1.0.0'
  s.summary        = 'App Group への書き出しとウィジェット再読み込み（W1-iOS）'
  s.description    = 'ウィジェットへ渡すスナップショットを App Group の UserDefaults に置き、WidgetCenter へ再読み込みを促す。'
  s.license        = 'MIT'
  s.author         = 'daidoko'
  s.homepage       = 'https://github.com/keisato848/daidoko'

  # **本体と同じ 15.1 に合わせる。** ここを上げるとアプリ全体の deploymentTarget も
  # 引き上げる必要が出る（@bacons/apple-targets の ExtensionStorage が 16.4 を
  # 要求していたのが、リンクされない一因の疑いだった）。
  # 使っている API は UserDefaults(suiteName:) と WidgetCenter（iOS 14+）だけなので
  # 15.1 で足りる。
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/keisato848/daidoko.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
