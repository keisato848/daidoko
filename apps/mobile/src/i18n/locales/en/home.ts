import type ja from '../ja/home';

const home: typeof ja = {
  // **短く保つ。** ヘッダーは3つのタブと4つのアイコンを1行に収める。
  // "This week"/"This month" だと選択中の下線が Calendar の下まで伸び、
  // Calendar が選ばれているように見えた（Pixel 9a・実機で確認）
  filter: {
    week: 'Week',
    month: 'Month',
    all: 'All',
  },

  loading: 'Loading your cooking records',

  action: {
    calendarLabel: 'Calendar',
    calendar: 'Calendar',
    galleryLabel: 'Photos',
    gallery: 'Gallery',
    shoppingLabel: 'Cart',
    shopping: 'Shopping list',
    settingsLabel: 'Settings',
    settings: 'Settings',
    helpLabel: 'Help',
  },

  select: {
    count: { one: '{{count}} selected', other: '{{count}} selected' },
    all: 'Select all',
  },

  delete: {
    title: 'Delete records',
    confirm: {
      one: {
        text: 'Delete {{count}} cooking record? This cannot be undone.',
        intent:
          'MUST state that the deletion CANNOT be undone, and MUST state how many records ' +
          'are affected. MUST NOT soften "cannot be undone" — the user has no other warning.',
      },
      other: {
        text: 'Delete {{count}} cooking records? This cannot be undone.',
        intent:
          'MUST state that the deletion CANNOT be undone, and MUST state how many records ' +
          'are affected. MUST NOT soften "cannot be undone" — the user has no other warning.',
      },
    },
  },

  consult: 'Plan it with AI',
  /** 在庫ループの入口。在庫に何か入っているときだけ出す */
  cookable: 'Cook from your pantry',
  capture: 'Photograph a dish',

  wantTitle: 'Want to recreate',

  empty: {
    allTitle: 'That dish you loved at a restaurant — capture it',
    allMessage:
      'One photo is all it takes: AI turns it into a recipe you can cook at home. Tell it how yours turned out, and it gets closer to the original.',
    weekTitle: 'Nothing recorded this week',
    monthTitle: 'Nothing recorded this month',
    filteredMessage: 'Pick a different period, or add a new record.',
  },

  coach: {
    fabTitle: 'Records and recipes start here',
    fabText:
      'Tap “+” to record a dish you cooked, or add a recipe — from a photo with AI, by planning it with AI, from a URL, or by hand.',
    cartTitle: 'Shopping list and pantry',
    cartText:
      'Your shopping list, what’s in the kitchen, receipt scanning, and “what can I cook with this” all live behind this cart.',
  },
};

export default home;
