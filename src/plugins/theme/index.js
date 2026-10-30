// Lets the server owner change the bot's brand art (logos, banners, roulette
// and mafia backgrounds, the divider line) and brand name from the website.
// Uploads are stored per-guild by the shared images store under the "theme"
// plugin id; everything else in the bot resolves art through theme.themePath,
// so an upload here takes effect everywhere automatically.
const fs = require('node:fs');
const path = require('node:path');
const { THEME_FILES, ASSETS } = require('../../core/theme');
const { I } = require('../../core/icons');

// Dashboard-editable images: key must match a THEME_FILES key.
const IMAGES = [
  { key: 'logo', label: 'الشعار الدائري', icon: 'sword' },
  { key: 'logoFlat', label: 'الشعار العادي', icon: 'sword' },
  { key: 'banner', label: 'البنر الرئيسي', icon: 'image' },
  { key: 'welcome', label: 'بنر الترحيب', icon: 'welcome' },
  { key: 'ticket', label: 'بنر التذاكر', icon: 'ticket' },
  { key: 'roles', label: 'بنر الرتب', icon: 'roles' },
  { key: 'colors', label: 'بنر الألوان', icon: 'colors' },
  { key: 'line', label: 'الخط الفاصل', icon: 'blade' },
];
// Note: game lobby art (الروليت/المافيا...) is edited from قسم «الألعاب» → تبويب الصور.

module.exports = {
  id: 'theme',
  name: 'Theme',
  nameAr: 'الثيم',
  emoji: I.sword,
  description: 'غيّر شعارات البوت والبنرات وخلفيات الألعاب واسم البراند من الموقع.',
  toggleable: false,
  defaults: {
    brandName: 'Sword',
  },
  dashboard: [
    {
      title: 'اسم البراند', icon: 'sword',
      description: 'الاسم اللي يظهر في بعض لوحات البوت.',
      fields: [
        { key: 'brandName', type: 'text', label: 'اسم البراند', max: 32 },
      ],
    },
  ],
  images: IMAGES,
  // Serve the default shipped asset when the server hasn't uploaded its own.
  async renderImage(key) {
    const name = THEME_FILES[key];
    if (!name) throw new Error('unknown theme image');
    return fs.promises.readFile(path.join(ASSETS, name));
  },
};
