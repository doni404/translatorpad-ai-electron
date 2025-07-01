const Store = require('electron-store');

// Define the schema for our settings
const schema = {
	shortcuts: {
		type: 'object',
		properties: {
			'capture-translate': {
				type: 'string',
				default: 'CommandOrControl+Shift+S'
			},
			'translate-paste': {
				type: 'string',
				default: 'CommandOrControl+Shift+R'
			},
			'copy-last-translation': {
				type: 'string',
				default: 'CommandOrControl+Shift+V'
			},
		},
		default: {}
	},
	targetLanguage: {
		type: 'string',
		default: 'en'
	}
};

class StoreService {
    constructor() {
        this.store = new Store({ schema });

        // Ensure defaults are set on first run
        this.store.set('shortcuts', {
            ...this.getDefaultShortcuts(),
            ...this.store.get('shortcuts')
        });
    }

    getDefaultShortcuts() {
        return {
            'capture-translate': 'CommandOrControl+Shift+S',
            'translate-paste': 'CommandOrControl+Shift+R',
            'copy-last-translation': 'CommandOrControl+Shift+V'
        };
    }

    getShortcuts() {
        return this.store.get('shortcuts');
    }

    getTargetLanguage() {
        return this.store.get('targetLanguage');
    }
    
    setShortcuts(shortcuts) {
        this.store.set('shortcuts', shortcuts);
    }

    setTargetLanguage(language) {
        this.store.set('targetLanguage', language);
    }

    resetShortcuts() {
        const defaults = this.getDefaultShortcuts();
        this.setShortcuts(defaults);
        return defaults;
    }
}

module.exports = { StoreService }; 