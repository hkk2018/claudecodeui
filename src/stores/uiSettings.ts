import { signal } from '@preact/signals-react';

// UI Settings stored in localStorage
const loadUiSettings = () => {
  try {
    const stored = localStorage.getItem('ui_settings');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.error('Failed to load UI settings:', err);
  }
  return {
    showIdeProjectBar: true, // Default: show IDE project bar
    showOverlayButton: true,  // Default: show overlay launch button
  };
};

const saveUiSettings = (settings) => {
  try {
    localStorage.setItem('ui_settings', JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save UI settings:', err);
  }
};

// Signal for UI settings
export const uiSettings = signal(loadUiSettings());

// Update settings
export const updateUiSettings = (updates) => {
  const newSettings = { ...uiSettings.value, ...updates };
  uiSettings.value = newSettings;
  saveUiSettings(newSettings);
};
