import type ja from '../ja/ui';

const ui: typeof ja = {
  coach: {
    skipLabel: 'Skip the walkthrough',
    skip: 'Skip',
    closeLabel: 'Close the walkthrough',
    nextLabel: 'Next tip',
    start: 'Get started',
    next: 'Next',
  },

  photo: {
    captureLabel: 'Take a photo',
    retake: 'Retake',
    capture: 'Camera',
    gallery: 'Library',
  },

  timer: {
    start: 'Start',
    pause: 'Pause',
    resume: 'Resume',
    reset: 'Reset',
    finished: 'Done!',
  },

  step: {
    placeholder: 'Describe the step…',
    timerLabel: '⏱ Timer',
    minutesSuffix: 'min',
    suggestLabel: 'Set a {{label}} timer',
    suggestSuffix: 'timer',
  },

  ingredient: {
    groupPlaceholder: 'Group (e.g. A — seasonings)',
    namePlaceholder: 'Ingredient',
    amountPlaceholder: 'Amount',
  },

  tag: {
    section: 'Tags',
    addPlaceholder: 'Add a new tag',
  },

  confirm: {
    title: 'Confirm',
  },

  help: {
    label: 'Show how this screen works',
    detailOpen: 'Show details for {{label}}',
    detailClose: 'Hide details for {{label}}',
  },

  stats: {
    cookUnit: {
      one: 'time',
      other: 'times',
    },
    dishUnit: {
      one: 'dish',
      other: 'dishes',
    },
  },

  tab: {
    home: 'Home',
    recipes: 'Recipes',
    add: 'Add',
    pantry: 'Pantry',
    shopping: 'Shopping',
    settings: 'Settings',
  },

  gallery: {
    title: 'Gallery',
    loading: 'Loading photos',
    emptyTitle: 'No photos yet',
    emptyMessage: 'Add a photo when you record your cooking and it will show up here.',
  },

  licenses: {
    title: 'Licenses',
    heading: 'Open-source licenses',
    body: 'DAIDOKO uses the open-source packages listed below. Copyright notices and full license texts are those shipped with each package.',
  },

  share: {
    servings: { one: 'Serves {{count}}', other: 'Serves {{count}}' },
    cookTime: { one: 'Cook time {{count}} min', other: 'Cook time {{count}} min' },
    ingredients: 'Ingredients',
    steps: 'Method',
    memo: 'Notes',
  },

  calendar: {
    title: 'Calendar',
    loading: 'Loading your cooking records',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    empty: 'Nothing recorded on this day',
    logCount: {
      one: '{{count}} record',
      other: '{{count}} records',
    },
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].join(','),
  },
};

export default ui;
