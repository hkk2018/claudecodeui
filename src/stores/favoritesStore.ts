/**
 * Favorites Store - localStorage-based session favorites management
 *
 * Stores favorite session keys as "projectName:sessionId" in localStorage.
 * Provides hooks and utilities for toggling and checking favorites.
 */

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'claude-code-ui-favorites';

function getFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]));
  // Dispatch a custom event so all components stay in sync
  window.dispatchEvent(new CustomEvent('favorites-changed'));
}

export function makeKey(projectName: string, sessionId: string): string {
  return `${projectName}:${sessionId}`;
}

export function isFavorite(projectName: string, sessionId: string): boolean {
  return getFavorites().has(makeKey(projectName, sessionId));
}

export function toggleFavorite(projectName: string, sessionId: string): boolean {
  const favorites = getFavorites();
  const key = makeKey(projectName, sessionId);
  const newState = !favorites.has(key);
  if (newState) {
    favorites.add(key);
  } else {
    favorites.delete(key);
  }
  saveFavorites(favorites);
  return newState;
}

/**
 * React hook that returns [isFavorite, toggleFavorite] for a given session.
 * Automatically syncs across components via custom event.
 */
export function useFavorite(projectName?: string, sessionId?: string): [boolean, () => void] {
  const [fav, setFav] = useState(() =>
    projectName && sessionId ? isFavorite(projectName, sessionId) : false
  );

  useEffect(() => {
    if (!projectName || !sessionId) {
      setFav(false);
      return;
    }
    setFav(isFavorite(projectName, sessionId));

    const handler = () => setFav(isFavorite(projectName, sessionId));
    window.addEventListener('favorites-changed', handler);
    return () => window.removeEventListener('favorites-changed', handler);
  }, [projectName, sessionId]);

  const toggle = useCallback(() => {
    if (projectName && sessionId) {
      const newState = toggleFavorite(projectName, sessionId);
      setFav(newState);
    }
  }, [projectName, sessionId]);

  return [fav, toggle];
}

/**
 * React hook that returns the full set of favorite keys.
 * Re-renders when favorites change.
 */
export function useFavorites(): Set<string> {
  const [favorites, setFavorites] = useState(() => getFavorites());

  useEffect(() => {
    const handler = () => setFavorites(getFavorites());
    window.addEventListener('favorites-changed', handler);
    return () => window.removeEventListener('favorites-changed', handler);
  }, []);

  return favorites;
}
