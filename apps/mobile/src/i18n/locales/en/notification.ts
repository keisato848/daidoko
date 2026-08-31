import type ja from '../ja/notification';

const notification: typeof ja = {
  timerChannel: 'Cooking timer',
  timerDoneTitle: 'Timer finished',
  timerDoneBody: 'Your cooking time is up.',

  cookingChannel: 'Cooking in progress',
  cookingBody: 'Step {{step}} of {{total}} · tap to resume',
  lowStockChannel: 'Low-stock alerts',
  lowStockTitle: 'Running low on ingredients',
  lowStockBody: 'You’re running low on {{names}}. Add them to your shopping list.',
  lowStockMore: {
    one: ' and {{count}} more',
    other: ' and {{count}} more',
  },

  menuChannel: 'Menu notifications',
  menuReadyTitle: "Today's menu is ready",
  menuReadyBody: 'Open the app to take a look.',
};

export default notification;
