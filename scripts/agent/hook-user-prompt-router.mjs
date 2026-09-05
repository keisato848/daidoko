/**
 * UserPromptSubmit: ユーザーの発話を lib/agent-router.mjs の対応表に当て、
 * 呼ぶべきエージェントが見えるときだけコンテキストを注入する。ブロックはしない。
 *
 * 自己検査: `node scripts/agent/hook-user-prompt-router.mjs --self-test`
 * （scripts/** にはテストが無いので、対応表を変えたら必ず回す）
 */
import { readStdinJson } from './lib/runtime.mjs';
import { routeContext, routePrompt } from './lib/agent-router.mjs';

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const payload = await readStdinJson();
  const prompt = payload?.user_prompt ?? payload?.prompt ?? '';
  const context = routeContext(prompt);
  if (!context) {
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  } else {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
      })}\n`,
    );
  }
}

function selfTest() {
  /** @type {Array<[string, string[]]>} 発話 → 期待する役（順序込み） */
  const cases = [
    ['今どこまで進んでる？次に何をすべき？', ['project-manager']],
    ['このブランチ、PR に出していい？', ['quality-manager']],
    ['献立に副菜の行を足したいんだけどどう思う', ['product-manager']],
    ['在庫の滞留アラートはどう実装すればいい？', ['app-leader']],
    ['さっきの emulator の件、次のセッション用に記録しておいて', ['finding-recorder']],
    ['railway にデプロイして疎通まで見て', ['server-verifier']],
    ['1.13.0 のリリースノート書いて', ['release-notes-drafter']],
    ['Issue を整理して', ['issue-groomer']],
    ['プロンプトを v2 に変えたら精度どうなる？', ['eval-inference']],
    ['リリースして良い状態？残タスクある？', ['project-manager', 'quality-manager']],
    ['/close-session', []],
    ['ありがとう', []],
    ['product-manager に聞いて', []],
    ['README のタイポを直して', []],
    ['品質基準の文書を読んで', []],
    ['README のスコープを直して', []],
    ['PR のレビューをして', ['quality-manager']],
    ['推論品質を上げたい', ['eval-inference']],
    ['広告の効果はどう？継続率も見たい', ['growth-analyst']],
    ['eCPM が低い気がする', ['growth-analyst']],
  ];
  let failed = 0;
  for (const [text, expected] of cases) {
    const got = routePrompt(text).map((r) => r.agent);
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? '[OK]' : '[NG]'} ${text} → ${JSON.stringify(got)}\n`);
  }
  process.stdout.write(`agent-router self-test: ${failed === 0 ? 'OK' : `${failed} failed`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}
