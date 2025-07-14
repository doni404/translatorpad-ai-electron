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
				default: 'CommandOrControl+Shift+T'
			}
		},
		default: {}
	},
	targetLanguage: {
		type: 'string',
		default: 'ja'
	}
};

class StoreService {
    constructor() {
        this.store = new Store({ schema });
        console.log('🏪 StoreService initialized');
        console.log('📂 Store file path:', this.store.path);

        // Ensure defaults are set on first run
        const existingShortcuts = this.store.get('shortcuts');
        console.log('📋 Existing shortcuts in store:', existingShortcuts);
        
        const defaults = this.getDefaultShortcuts();
        console.log('📋 Default shortcuts:', defaults);
        
        const mergedShortcuts = {
            ...defaults,
            ...existingShortcuts
        };
        
        // Remove the copy-last-translation shortcut if it exists
        if (mergedShortcuts['copy-last-translation']) {
            delete mergedShortcuts['copy-last-translation'];
            console.log('🗑️ Removed copy-last-translation shortcut from config');
        }
        
        console.log('📋 Merged shortcuts to store:', mergedShortcuts);
        this.store.set('shortcuts', mergedShortcuts);
        
        // Verify the shortcuts were stored
        const storedShortcuts = this.store.get('shortcuts');
        console.log('📋 Verified stored shortcuts:', storedShortcuts);
    }

    getDefaultShortcuts() {
        const defaults = {
            'capture-translate': 'CommandOrControl+Shift+S',
            'translate-paste': 'CommandOrControl+Shift+T'
        };
        console.log('📋 Getting default shortcuts:', defaults);
        return defaults;
    }

    getShortcuts() {
        const shortcuts = this.store.get('shortcuts');
        console.log('📋 Retrieved shortcuts from store:', shortcuts);
        return shortcuts;
    }

    getTargetLanguage() {
        const language = this.store.get('targetLanguage');
        console.log('🌍 Retrieved target language:', language);
        return language;
    }
    
    setShortcuts(shortcuts) {
        console.log('📋 Setting shortcuts in store:', shortcuts);
        this.store.set('shortcuts', shortcuts);
        
        // Verify the shortcuts were stored
        const storedShortcuts = this.store.get('shortcuts');
        console.log('📋 Verified stored shortcuts after set:', storedShortcuts);
    }

    setTargetLanguage(language) {
        console.log('🌍 Setting target language:', language);
        this.store.set('targetLanguage', language);
    }

    resetShortcuts() {
        console.log('🔄 Resetting shortcuts to defaults');
        const defaults = this.getDefaultShortcuts();
        this.setShortcuts(defaults);
        return defaults;
    }
}

module.exports = { StoreService }; 