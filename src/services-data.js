// Shared service definitions — included by background.js (importScripts),
// options.js, and popup.js via <script> tags.

// Brand icons from https://about.google/brand-resource-center/logos-list/
function _icon(file) {
  return `<img src="icons/${file}" width="32" height="32" alt="">`;
}

const SERVICE_DEFS = {
  'mail.google.com':           { label: 'Gmail',        icon: _icon('gmail.webp')        },
  'chat.google.com':           { label: 'Chat',         icon: _icon('chat.webp')         },
  'meet.google.com':           { label: 'Meet',         icon: _icon('meet.webp')         },
  'calendar.google.com':       { label: 'Calendar',     icon: _icon('calendar.webp')     },
  'drive.google.com':          { label: 'Drive',        icon: _icon('drive.webp')        },
  'docs.google.com':           { label: 'Docs',         icon: _icon('docs.webp')         },
  'sheets.google.com':         { label: 'Sheets',       icon: _icon('sheets.webp')       },
  'slides.google.com':         { label: 'Slides',       icon: _icon('slides.webp')       },
  'forms.google.com':          { label: 'Forms',        icon: _icon('forms.webp')        },
  'keep.google.com':           { label: 'Keep',         icon: _icon('keep.webp')         },
  'contacts.google.com':       { label: 'Contacts',     icon: _icon('contacts.png')      },
  'classroom.google.com':      { label: 'Classroom',    icon: _icon('classroom.svg')     },
  'sites.google.com':          { label: 'Sites',        icon: _icon('sites.webp')        },
  'groups.google.com':         { label: 'Groups',       icon: _icon('groups.png')        },
  'photos.google.com':         { label: 'Photos',       icon: _icon('photos.webp')       },
  'voice.google.com':          { label: 'Voice',        icon: _icon('voice.webp')        },
  'play.google.com':           { label: 'Play',         icon: _icon('play.webp')         },
  'one.google.com':            { label: 'One',          icon: _icon('one.webp')          },
  'admin.google.com':          { label: 'Admin',        icon: _icon('admin.webp')        },
  'analytics.google.com':      { label: 'Analytics',    icon: _icon('analytics.svg')     },
  'ads.google.com':            { label: 'Ads',          icon: _icon('ads.webp')          },
  'lookerstudio.google.com':   { label: 'Looker Studio',icon: _icon('lookerstudio.webp') },
  'colab.research.google.com': { label: 'Colab',        icon: _icon('colab.svg')         },
  'maps.google.com':           { label: 'Maps',         icon: _icon('maps.webp')         },
  'gemini.google.com':         { label: 'Gemini',       icon: _icon('gemini.svg')        },
  'myaccount.google.com':      { label: 'My Account',   icon: _icon('google.webp')       },
};

const SERVICE_GROUPS = [
  {
    id: 'workspace',
    label: 'Workspace',
    hosts: [
      'mail.google.com', 'chat.google.com', 'meet.google.com', 'calendar.google.com',
      'drive.google.com', 'docs.google.com', 'sheets.google.com',
      'slides.google.com', 'forms.google.com',
      'keep.google.com', 'contacts.google.com',
      'sites.google.com', 'groups.google.com',
    ],
  },
  {
    id: 'personal',
    label: 'Personal',
    hosts: [
      'gemini.google.com', 'photos.google.com', 'voice.google.com', 'play.google.com',
      'maps.google.com', 'classroom.google.com',
    ],
  },
  {
    id: 'account-storage',
    label: 'Account & Storage',
    hosts: [
      'myaccount.google.com', 'one.google.com', 'admin.google.com',
    ],
  },
  {
    id: 'developer-business',
    label: 'Developer & Business',
    hosts: [
      'analytics.google.com', 'ads.google.com',
      'lookerstudio.google.com', 'colab.research.google.com',
    ],
  },
];
