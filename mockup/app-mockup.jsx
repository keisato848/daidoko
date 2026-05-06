import { useState } from "react";

// ── Brand colors ──────────────────────────────────────────────
const C = {
  bg:          "#0A0805",
  bgCard:      "#130C06",
  bgInput:     "#1C1409",
  bgOverlay:   "rgba(10,8,5,0.85)",
  border:      "#2E2418",
  borderLight: "#3D3020",
  gold:        "#C9A16A",
  goldDim:     "#A07A44",
  paper:       "#F0E6D2",
  paperDim:    "#DCC9A8",
  muted:       "#5A4A34",
  white:       "#FFFFFF",
};

// ── Sample data ───────────────────────────────────────────────
const RECIPES = [
  { id: "1", title: "肉じゃが",    tags: ["肉","煮物","定番"], servings: 4, cookTime: 30, rating: 4 },
  { id: "2", title: "味噌汁",      tags: ["汁物","定番"],      servings: 4, cookTime: 10, rating: 5 },
  { id: "3", title: "唐揚げ",      tags: ["肉","揚げ物"],      servings: 4, cookTime: 25, rating: 5 },
  { id: "4", title: "炊き込みご飯", tags: ["ご飯","秋"],        servings: 4, cookTime: 45, rating: 4 },
  { id: "5", title: "豚汁",        tags: ["汁物","冬"],         servings: 4, cookTime: 20, rating: 4 },
  { id: "6", title: "ハンバーグ",  tags: ["肉","洋食"],         servings: 4, cookTime: 35, rating: 5 },
];

const TIMELINE = [
  { id: "t1", recipeId: "1", recipe: "肉じゃが",    user: "恵", avatar: "恵", date: "05月04日", rating: 4, memo: "だしを多めにした。次回も同じで◎", emoji: "🍲" },
  { id: "t2", recipeId: "2", recipe: "味噌汁",      user: "健", avatar: "健", date: "05月03日", rating: 5, memo: "", emoji: "🍜" },
  { id: "t3", recipeId: "3", recipe: "唐揚げ",      user: "恵", avatar: "恵", date: "04月28日", rating: 5, memo: "ニンニク多めで大好評！", emoji: "🍗" },
  { id: "t4", recipeId: "4", recipe: "炊き込みご飯", user: "陽", avatar: "陽", date: "04月20日", rating: 4, memo: "", emoji: "🍚" },
];

// 各レシピの食材（検索・詳細表示兼用）
const RECIPE_INGREDIENTS = {
  "1": [
    { group: "",         name: "じゃがいも（メークイン）", amount: "3個" },
    { group: "",         name: "玉ねぎ",                   amount: "1個" },
    { group: "",         name: "牛薄切り肉",               amount: "200g" },
    { group: "",         name: "にんじん",                 amount: "½本" },
    { group: "A 調味料", name: "醤油",                     amount: "大さじ3" },
    { group: "A 調味料", name: "みりん",                   amount: "大さじ3" },
    { group: "A 調味料", name: "砂糖",                     amount: "大さじ2" },
    { group: "A 調味料", name: "だし汁",                   amount: "300ml" },
  ],
  "2": [
    { group: "",         name: "豆腐",                     amount: "½丁" },
    { group: "",         name: "わかめ",                   amount: "適量" },
    { group: "",         name: "玉ねぎ",                   amount: "½個" },
    { group: "A 調味料", name: "味噌",                     amount: "大さじ2" },
    { group: "A 調味料", name: "だし汁",                   amount: "600ml" },
  ],
  "3": [
    { group: "",         name: "鶏もも肉",                 amount: "500g" },
    { group: "A 下味",   name: "醤油",                     amount: "大さじ2" },
    { group: "A 下味",   name: "にんにく",                 amount: "2かけ" },
    { group: "A 下味",   name: "しょうが",                 amount: "1かけ" },
    { group: "A 下味",   name: "酒",                       amount: "大さじ1" },
    { group: "B 衣",     name: "片栗粉",                   amount: "適量" },
    { group: "B 衣",     name: "薄力粉",                   amount: "適量" },
  ],
  "4": [
    { group: "",         name: "米",                       amount: "2合" },
    { group: "",         name: "鶏もも肉",                 amount: "150g" },
    { group: "",         name: "にんじん",                 amount: "½本" },
    { group: "",         name: "ごぼう",                   amount: "½本" },
    { group: "",         name: "油揚げ",                   amount: "1枚" },
    { group: "A 調味料", name: "醤油",                     amount: "大さじ2" },
    { group: "A 調味料", name: "みりん",                   amount: "大さじ2" },
    { group: "A 調味料", name: "酒",                       amount: "大さじ1" },
  ],
  "5": [
    { group: "",         name: "豚バラ肉",                 amount: "150g" },
    { group: "",         name: "大根",                     amount: "¼本" },
    { group: "",         name: "にんじん",                 amount: "½本" },
    { group: "",         name: "じゃがいも",               amount: "2個" },
    { group: "",         name: "玉ねぎ",                   amount: "1個" },
    { group: "",         name: "ごぼう",                   amount: "½本" },
    { group: "A 調味料", name: "味噌",                     amount: "大さじ3" },
    { group: "A 調味料", name: "だし汁",                   amount: "800ml" },
  ],
  "6": [
    { group: "",         name: "合い挽き肉",               amount: "300g" },
    { group: "",         name: "玉ねぎ",                   amount: "½個" },
    { group: "",         name: "卵",                       amount: "1個" },
    { group: "",         name: "パン粉",                   amount: "大さじ3" },
    { group: "",         name: "牛乳",                     amount: "大さじ2" },
    { group: "A ソース", name: "ウスターソース",           amount: "大さじ2" },
    { group: "A ソース", name: "ケチャップ",               amount: "大さじ2" },
  ],
};

// 後方互換（調理モードで肉じゃがを使用）
const INGREDIENTS = RECIPE_INGREDIENTS["1"];

const STEPS = [
  { n: 1, body: "じゃがいもは皮をむき一口大に切る。水にさらしてアクを抜く。", timer: null },
  { n: 2, body: "玉ねぎはくし形に、にんじんは乱切りにする。", timer: null },
  { n: 3, body: "鍋に油を熱し牛肉を炒める。色が変わったら野菜を加えて炒める。", timer: 180 },
  { n: 4, body: "Aの調味料とだし汁を加え、落し蓋をして中火で煮る。", timer: 900 },
  { n: 5, body: "じゃがいもに竹串がすっと通れば完成。器に盛り付ける。", timer: null },
];

// ── Shared micro-components ───────────────────────────────────
function Stars({ n, size = 11 }) {
  return (
    <span style={{ color: C.gold, fontSize: size, letterSpacing: 1 }}>
      {"★".repeat(n)}{"☆".repeat(5 - n)}
    </span>
  );
}

function Tag({ label }) {
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 20,
      border: `1px solid ${C.border}`, color: C.goldDim,
      background: C.bgCard, letterSpacing: 0.5, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function Avatar({ char }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: "#2A1E0E", border: `1px solid ${C.goldDim}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, color: C.paperDim, flexShrink: 0,
    }}>
      {char}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: C.border, margin: "0 20px" }} />;
}

function BackButton({ onPress, label = "戻る" }) {
  return (
    <button onClick={onPress} style={{
      background: "none", border: "none", cursor: "pointer",
      color: C.goldDim, fontSize: 13, display: "flex", alignItems: "center", gap: 4, padding: 0,
    }}>
      ‹ {label}
    </button>
  );
}

// ── Screen: Timeline (Home) ───────────────────────────────────
function ScreenTimeline({ nav }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* Filter tabs — DAIDOKO wordmark は右端に極小で */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        padding: "10px 16px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <div style={{ flex: 1, display: "flex" }}>
          {["今週", "今月", "すべて"].map((t, i) => (
            <div key={t} style={{
              padding: "4px 14px 8px", fontSize: 12, cursor: "pointer",
              color: i === 0 ? C.gold : C.muted,
              borderBottom: i === 0 ? `2px solid ${C.gold}` : "2px solid transparent",
              marginBottom: -1,
            }}>{t}</div>
          ))}
        </div>
        <span style={{
          fontFamily: "'Cormorant Garamond', 'Georgia', serif",
          fontSize: 9, color: C.muted, letterSpacing: 4,
          fontStyle: "italic", paddingBottom: 8,
        }}>DAIDOKO</span>
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {TIMELINE.map((log, i) => (
          <div key={log.id}>
            {(i === 0 || TIMELINE[i - 1].date !== log.date) && (
              <div style={{
                padding: "10px 20px 4px", fontSize: 10,
                color: C.muted, letterSpacing: 2,
              }}>{log.date}</div>
            )}
            <div
              onClick={() => nav("recipe-detail", { id: log.recipeId })}
              style={{
                margin: "6px 16px", padding: "12px 14px",
                background: C.bgCard, borderRadius: 8,
                border: `1px solid ${C.border}`, cursor: "pointer",
                display: "flex", gap: 12, alignItems: "flex-start",
              }}>
              <div style={{
                width: 52, height: 52, borderRadius: 6, flexShrink: 0,
                background: "#1E1509", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 24,
              }}>{log.emoji}</div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ color: C.paper, fontSize: 14, fontWeight: 500 }}>{log.recipe}</span>
                  <Stars n={log.rating} size={10} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <Avatar char={log.avatar} />
                  <span style={{ fontSize: 11, color: C.muted }}>{log.user}</span>
                </div>
                {log.memo && (
                  <div style={{
                    fontSize: 11, color: C.goldDim, fontStyle: "italic",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>"{log.memo}"</div>
                )}
              </div>
            </div>
          </div>
        ))}
        <div style={{ height: 80 }} />
      </div>

      {/* Floating + button */}
      <button
        onClick={() => nav("add-method")}
        style={{
          position: "absolute", bottom: 16, right: 16,
          width: 48, height: 48, borderRadius: "50%",
          background: C.gold, border: "none", cursor: "pointer",
          fontSize: 24, color: C.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 16px rgba(201,161,106,0.4)",
        }}>＋</button>
    </div>
  );
}

// ── Screen: Recipe List ───────────────────────────────────────
function ScreenRecipeList({ nav }) {
  const [query, setQuery] = useState("");

  // 食材名にもヒットさせる。ヒットした食材名を返す
  function matchedIngredients(recipeId, q) {
    if (!q) return [];
    return (RECIPE_INGREDIENTS[recipeId] || [])
      .filter(ing => ing.name.includes(q))
      .map(ing => ing.name);
  }

  const filtered = RECIPES.filter(r => {
    if (!query) return true;
    if (r.title.includes(query)) return true;
    if (r.tags.some(t => t.includes(query))) return true;
    if (matchedIngredients(r.id, query).length > 0) return true;
    return false;
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{
          background: C.bgInput, borderRadius: 8, border: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
        }}>
          <span style={{ color: C.muted, fontSize: 14 }}>🔍</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="レシピを探す"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: C.paper, fontSize: 13,
            }}
          />
        </div>
      </div>

      {/* Tag filter */}
      <div style={{
        display: "flex", gap: 6, padding: "10px 16px",
        overflowX: "auto", flexShrink: 0, borderBottom: `1px solid ${C.border}`,
      }}>
        {["すべて", "肉", "魚", "野菜", "汁物", "ご飯", "洋食"].map((t, i) => (
          <div key={t} style={{
            padding: "3px 12px", borderRadius: 16, whiteSpace: "nowrap",
            fontSize: 11, cursor: "pointer", flexShrink: 0,
            background: i === 0 ? C.gold : C.bgCard,
            color: i === 0 ? C.bg : C.muted,
            border: `1px solid ${i === 0 ? C.gold : C.border}`,
          }}>{t}</div>
        ))}
      </div>

      {/* 検索結果ヒント */}
      {query.length > 0 && (
        <div style={{ padding: "6px 16px 0", fontSize: 11, color: C.muted }}>
          {filtered.length} 件{" "}
          {filtered.some(r => matchedIngredients(r.id, query).length > 0) && (
            <span style={{ color: C.goldDim }}>（食材名でヒットあり）</span>
          )}
        </div>
      )}

      {/* Grid */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "12px 16px",
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
        alignContent: "start",
      }}>
        {filtered.map(r => {
          const hits = matchedIngredients(r.id, query);
          return (
          <div
            key={r.id}
            onClick={() => nav("recipe-detail", { id: r.id })}
            style={{
              background: C.bgCard, borderRadius: 8,
              border: `1px solid ${hits.length > 0 ? C.goldDim : C.border}`,
              cursor: "pointer", overflow: "hidden",
            }}>
            <div style={{
              height: 80, background: "#1A1108",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, borderBottom: `1px solid ${C.border}`,
            }}>
              {["🍲","🍜","🍗","🍚","🫕","🍔"][parseInt(r.id) - 1]}
            </div>
            <div style={{ padding: "8px 10px" }}>
              <div style={{ fontSize: 13, color: C.paper, marginBottom: 4 }}>{r.title}</div>
              <Stars n={r.rating} size={10} />
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>⏱ {r.cookTime}分</div>
              {hits.length > 0 && (
                <div style={{
                  marginTop: 5, fontSize: 10, color: C.goldDim,
                  background: "#1E1509", borderRadius: 4,
                  padding: "2px 6px", lineHeight: 1.5,
                }}>
                  🥬 {hits.slice(0, 2).join("・")}{hits.length > 2 ? " …" : ""}
                </div>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Screen: Recipe Detail ─────────────────────────────────────
function ScreenRecipeDetail({ recipeId, nav }) {
  const recipe = RECIPES.find(r => r.id === recipeId) || RECIPES[0];
  const emojis = ["🍲","🍜","🍗","🍚","🫕","🍔"];
  const emoji = emojis[parseInt(recipe.id) - 1] || "🍲";

  const [tab, setTab] = useState("ingredients");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Hero */}
      <div style={{
        height: 140, background: "#1A1108", flexShrink: 0, position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56,
        borderBottom: `1px solid ${C.border}`,
      }}>
        {emoji}
        <div style={{
          position: "absolute", top: 12, left: 16,
        }}>
          <BackButton onPress={() => nav("recipe-list")} />
        </div>
      </div>

      {/* Meta */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 20, color: C.paper, marginBottom: 6, letterSpacing: 1 }}>{recipe.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Stars n={recipe.rating} size={12} />
          <span style={{ fontSize: 11, color: C.muted }}>👥 {recipe.servings}人前</span>
          <span style={{ fontSize: 11, color: C.muted }}>⏱ {recipe.cookTime}分</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {recipe.tags.map(t => <Tag key={t} label={t} />)}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {[["ingredients","材料"],["steps","手順"],["memo","メモ"]].map(([key, label]) => (
          <div key={key} onClick={() => setTab(key)} style={{
            flex: 1, textAlign: "center", padding: "10px 0", fontSize: 12, cursor: "pointer",
            color: tab === key ? C.gold : C.muted,
            borderBottom: tab === key ? `2px solid ${C.gold}` : "2px solid transparent",
            marginBottom: -1,
          }}>{label}</div>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
        {tab === "ingredients" && (
          <div>
            {(RECIPE_INGREDIENTS[recipe.id] || INGREDIENTS).map((ing, i) => (
              <div key={i}>
                {ing.group && (i === 0 || (RECIPE_INGREDIENTS[recipe.id] || INGREDIENTS)[i-1].group !== ing.group) && (
                  <div style={{ fontSize: 10, color: C.goldDim, marginTop: 12, marginBottom: 6, letterSpacing: 1 }}>
                    {ing.group}
                  </div>
                )}
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "8px 0", borderBottom: `1px solid ${C.border}`,
                }}>
                  <span style={{ fontSize: 13, color: C.paperDim }}>{ing.name}</span>
                  <span style={{ fontSize: 13, color: C.goldDim }}>{ing.amount}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "steps" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {STEPS.map(step => (
              <div key={step.n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                  background: "#2A1E0E", border: `1px solid ${C.goldDim}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, color: C.gold,
                }}>{step.n}</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, color: C.paperDim, margin: 0, lineHeight: 1.7 }}>{step.body}</p>
                  {step.timer && (
                    <div style={{
                      marginTop: 6, display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 11, color: C.gold, background: "#1E1509",
                      border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 8px",
                    }}>
                      ⏱ {step.timer >= 60 ? `${Math.floor(step.timer/60)}分` : `${step.timer}秒`}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "memo" && (
          <div>
            <div style={{
              padding: 12, background: "#1C1409",
              border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12,
              borderLeft: `3px solid ${C.gold}`,
            }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>恵 · 05/04</div>
              <p style={{ fontSize: 13, color: C.paperDim, margin: 0, lineHeight: 1.7 }}>
                だしを多めにした。次回も同じで◎
              </p>
            </div>
            <div style={{
              padding: 12, border: `1px dashed ${C.border}`, borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: C.muted, fontSize: 12, gap: 6,
            }}>
              ＋ メモを追加
            </div>
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>

      {/* CTA */}
      <div style={{
        padding: "12px 20px", borderTop: `1px solid ${C.border}`,
        background: C.bg, flexShrink: 0,
      }}>
        <button
          onClick={() => nav("cooking-mode")}
          style={{
            width: "100%", padding: "14px 0",
            background: C.gold, border: "none", borderRadius: 8,
            color: C.bg, fontSize: 15, fontWeight: 600,
            cursor: "pointer", letterSpacing: 2,
          }}>調理開始</button>
      </div>
    </div>
  );
}

// ── Screen: Cooking Mode ──────────────────────────────────────
function ScreenCookingMode({ nav }) {
  const [step, setStep] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const current = STEPS[step];
  const progress = (step + 1) / STEPS.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px", display: "flex",
        alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <button onClick={() => nav("recipe-detail", { id: "1" })} style={{
          background: "none", border: "none", cursor: "pointer",
          color: C.muted, fontSize: 20, lineHeight: 1,
        }}>✕</button>
        <span style={{ fontSize: 14, color: C.paperDim, letterSpacing: 1 }}>肉じゃが</span>
        <span style={{ fontSize: 12, color: C.muted }}>{step + 1} / {STEPS.length}</span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: C.border, flexShrink: 0 }}>
        <div style={{ height: "100%", background: C.gold, width: `${progress * 100}%`, transition: "width 0.3s" }} />
      </div>

      {/* Step content */}
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", padding: "32px 28px",
          cursor: "pointer",
        }}
        onClick={() => setShowIngredients(!showIngredients)}
      >
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: "#2A1E0E", border: `2px solid ${C.gold}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, color: C.gold, marginBottom: 24,
        }}>{current.n}</div>

        <p style={{
          fontSize: 18, color: C.paper, textAlign: "center",
          lineHeight: 1.8, margin: 0, letterSpacing: 0.5,
        }}>{current.body}</p>

        {current.timer && (
          <div style={{
            marginTop: 24, padding: "10px 24px",
            background: "#1A1108", border: `1px solid ${C.gold}`,
            borderRadius: 8, display: "flex", alignItems: "center", gap: 8,
            cursor: "pointer",
          }}>
            <span style={{ fontSize: 18 }}>⏱</span>
            <span style={{ color: C.gold, fontSize: 16 }}>
              {current.timer >= 60
                ? `${Math.floor(current.timer / 60)}分 タイマーを開始`
                : `${current.timer}秒 タイマーを開始`}
            </span>
          </div>
        )}

        <p style={{ fontSize: 11, color: C.muted, marginTop: 20 }}>
          画面をタップで材料を表示
        </p>
      </div>

      {/* Nav buttons */}
      <div style={{
        display: "flex", padding: "12px 20px", gap: 12,
        borderTop: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <button
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          style={{
            flex: 1, padding: "12px 0", borderRadius: 8,
            background: "none", border: `1px solid ${step === 0 ? C.border : C.goldDim}`,
            color: step === 0 ? C.muted : C.goldDim, fontSize: 14, cursor: step === 0 ? "default" : "pointer",
          }}>← 前へ</button>

        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            style={{
              flex: 2, padding: "12px 0", borderRadius: 8,
              background: C.gold, border: "none",
              color: C.bg, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>次へ →</button>
        ) : (
          <button
            onClick={() => nav("timeline")}
            style={{
              flex: 2, padding: "12px 0", borderRadius: 8,
              background: "#2A6040", border: `1px solid #3D8A5A`,
              color: "#7FFFAA", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>✓ 完成！記録する</button>
        )}
      </div>

      {/* Ingredients overlay */}
      {showIngredients && (
        <div
          onClick={() => setShowIngredients(false)}
          style={{
            position: "absolute", inset: 0, background: C.bgOverlay,
            display: "flex", flexDirection: "column", justifyContent: "flex-end",
            zIndex: 10,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#150F08", borderTop: `1px solid ${C.border}`,
              borderRadius: "16px 16px 0 0", padding: "20px 20px 32px",
              maxHeight: "60%", overflowY: "auto",
            }}>
            <div style={{
              width: 36, height: 3, background: C.border,
              borderRadius: 2, margin: "0 auto 16px",
            }} />
            <div style={{ fontSize: 12, color: C.goldDim, letterSpacing: 2, marginBottom: 12 }}>
              材料（4人前）
            </div>
            {INGREDIENTS.map((ing, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between",
                padding: "7px 0", borderBottom: `1px solid ${C.border}`,
              }}>
                <span style={{ fontSize: 13, color: C.paperDim }}>{ing.name}</span>
                <span style={{ fontSize: 13, color: C.goldDim }}>{ing.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Screen: Add Method ────────────────────────────────────────
function ScreenAddMethod({ nav }) {
  const methods = [
    { icon: "🔗", title: "URLから取り込む",   sub: "レシピサイトのURLを貼るだけ",    screen: "timeline" },
    { icon: "📷", title: "写真から読み取る",   sub: "本・メモ・切り抜きをOCRで取得",   screen: "timeline" },
    { icon: "✏️", title: "手で入力する",       sub: "材料・手順を直接入力",             screen: "timeline" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <BackButton onPress={() => nav("timeline")} label="キャンセル" />
        <div style={{ marginTop: 10, fontSize: 16, color: C.paper, letterSpacing: 1 }}>
          レシピを追加
        </div>
      </div>
      <div style={{ flex: 1, padding: "20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {methods.map(m => (
          <div
            key={m.title}
            onClick={() => nav(m.screen)}
            style={{
              padding: "18px 20px", background: C.bgCard,
              border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 16,
            }}>
            <span style={{ fontSize: 28 }}>{m.icon}</span>
            <div>
              <div style={{ fontSize: 14, color: C.paper, marginBottom: 3 }}>{m.title}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{m.sub}</div>
            </div>
            <span style={{ marginLeft: "auto", color: C.muted, fontSize: 16 }}>›</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab Bar ───────────────────────────────────────────────────
function TabBar({ current, nav }) {
  const tabs = [
    { id: "timeline",     icon: "🏠", label: "ホーム" },
    { id: "recipe-list",  icon: "📖", label: "レシピ" },
    { id: "add-method",   icon: "＋", label: "追加",  special: true },
    { id: "settings",     icon: "⚙",  label: "設定" },
  ];
  return (
    <div style={{
      height: 58, borderTop: `1px solid ${C.border}`,
      display: "flex", background: C.bg, flexShrink: 0,
    }}>
      {tabs.map(t => (
        <div
          key={t.id}
          onClick={() => nav(t.id)}
          style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 2,
            cursor: "pointer",
            color: current === t.id ? C.gold : C.muted,
          }}>
          {t.special ? (
            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: current === t.id ? C.gold : "#2A1E0E",
              border: `1px solid ${current === t.id ? C.gold : C.goldDim}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: current === t.id ? C.bg : C.goldDim,
              marginTop: -10,
            }}>{t.icon}</div>
          ) : (
            <span style={{ fontSize: 18 }}>{t.icon}</span>
          )}
          <span style={{ fontSize: 9, letterSpacing: 0.5 }}>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Settings placeholder ──────────────────────────────────────
function ScreenSettings({ nav }) {
  const items = [
    { section: "アカウント", rows: ["プロフィール編集"] },
    { section: "家族グループ", rows: ["グループ管理 — 招待コード: AB•C123"] },
    { section: "データ", rows: ["バックアップ・復元", "ストレージ使用量"] },
    { section: "アプリ", rows: ["通知設定", "バージョン 0.1.0"] },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 16, color: C.paper, letterSpacing: 1 }}>設定</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {items.map(sec => (
          <div key={sec.section}>
            <div style={{ padding: "14px 20px 6px", fontSize: 10, color: C.muted, letterSpacing: 2 }}>
              {sec.section}
            </div>
            {sec.rows.map(row => (
              <div key={row} style={{
                padding: "13px 20px", borderBottom: `1px solid ${C.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                cursor: "pointer",
              }}>
                <span style={{ fontSize: 13, color: C.paperDim }}>{row}</span>
                <span style={{ color: C.muted, fontSize: 14 }}>›</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("timeline");
  const [params, setParams]  = useState({});

  const HIDE_TABBAR = ["cooking-mode", "add-method"];

  function nav(screenId, p = {}) {
    setScreen(screenId);
    setParams(p);
    // scroll top
    setTimeout(() => {
      const el = document.getElementById("daidoko-scroll");
      if (el) el.scrollTop = 0;
    }, 0);
  }

  function renderScreen() {
    switch (screen) {
      case "timeline":      return <ScreenTimeline nav={nav} />;
      case "recipe-list":   return <ScreenRecipeList nav={nav} />;
      case "recipe-detail": return <ScreenRecipeDetail recipeId={params.id || "1"} nav={nav} />;
      case "cooking-mode":  return <ScreenCookingMode nav={nav} />;
      case "add-method":    return <ScreenAddMethod nav={nav} />;
      case "settings":      return <ScreenSettings nav={nav} />;
      default:              return <ScreenTimeline nav={nav} />;
    }
  }

  const showTabBar = !HIDE_TABBAR.includes(screen);

  return (
    <div style={{
      minHeight: "100vh", background: "#1A1208",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif",
      padding: "20px 0",
    }}>
      {/* Phone frame */}
      <div style={{
        width: 375, height: 700,
        background: C.bg, borderRadius: 36,
        border: `2px solid #2A1E0E`,
        boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)",
        display: "flex", flexDirection: "column",
        overflow: "hidden", position: "relative",
      }}>
        {/* Status bar */}
        <div style={{
          height: 36, background: C.bg, flexShrink: 0,
          display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "0 20px",
        }}>
          <span style={{ fontSize: 11, color: C.muted }}>9:41</span>
          <div style={{
            width: 80, height: 20, background: "#0A0805",
            borderRadius: 10, border: `1px solid #1A1208`,
          }} />
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.muted }}>●●●</span>
            <span style={{ fontSize: 10, color: C.muted }}>100%</span>
          </div>
        </div>

        {/* Screen area */}
        <div id="daidoko-scroll" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {renderScreen()}
        </div>

        {/* Tab bar */}
        {showTabBar && (
          <TabBar current={screen} nav={nav} />
        )}
      </div>
    </div>
  );
}
