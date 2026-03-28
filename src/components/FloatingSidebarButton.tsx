import React, { useState, useEffect, useRef } from 'react';
import { Menu } from 'lucide-react';

/**
 * FloatingSidebarButton - A draggable floating button to open sidebar on mobile
 *
 * Features:
 * - Draggable: Tap and drag to reposition (instant response)
 * - Semi-transparent: Can see content behind the button
 * - Positioned in the left-bottom area by default
 * - Only displays on mobile devices when enabled in Settings → Appearance
 */
function FloatingSidebarButton({ onClick, isMobile, showFloatingButton }) {
  const [position, setPosition] = useState(() => {
    // Load saved position from localStorage
    try {
      const saved = localStorage.getItem('floatingButtonPosition');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load button position:', error);
    }

    // Default position: left-bottom (calculated from viewport height)
    // We'll set it dynamically in useEffect
    return null;
  });

  const [isDragging, setIsDragging] = useState(false);
  const buttonRef = useRef(null);
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    hasMoved: false,
    currentX: 0,
    currentY: 0
  });

  // Initialize default position if not set
  useEffect(() => {
    if (position === null) {
      // Default: left-bottom, 140px from bottom
      const defaultY = window.innerHeight - 140 - 52; // 52 is button height
      setPosition({ x: 16, y: defaultY });
    }
  }, [position]);

  // Save position to localStorage
  useEffect(() => {
    if (position !== null) {
      try {
        localStorage.setItem('floatingButtonPosition', JSON.stringify(position));
      } catch (error) {
        console.error('Failed to save button position:', error);
      }
    }
  }, [position]);

  const updateButtonPosition = (x, y) => {
    if (!buttonRef.current) return;

    // Keep button within viewport bounds
    const maxX = window.innerWidth - 52;
    const maxY = window.innerHeight - 52;
    const boundedX = Math.max(0, Math.min(x, maxX));
    const boundedY = Math.max(0, Math.min(y, maxY));

    // Update DOM directly - use left/top for immediate response
    buttonRef.current.style.left = `${boundedX}px`;
    buttonRef.current.style.top = `${boundedY}px`;

    dragState.current.currentX = boundedX;
    dragState.current.currentY = boundedY;
  };

  const handleTouchStart = (e) => {
    if (!buttonRef.current) return;

    const touch = e.touches[0];
    const rect = buttonRef.current.getBoundingClientRect();

    dragState.current = {
      isDragging: true,
      startX: touch.clientX - rect.left,
      startY: touch.clientY - rect.top,
      hasMoved: false,
      currentX: rect.left,
      currentY: rect.top
    };

    setIsDragging(true);
  };

  const handleTouchMove = (e) => {
    if (!dragState.current.isDragging) return;

    e.preventDefault();
    e.stopPropagation();

    const touch = e.touches[0];
    const newX = touch.clientX - dragState.current.startX;
    const newY = touch.clientY - dragState.current.startY;

    // Check if moved more than 5px to distinguish from tap
    const moveDistance = Math.sqrt(
      Math.pow(newX - dragState.current.currentX, 2) +
      Math.pow(newY - dragState.current.currentY, 2)
    );

    if (moveDistance > 5) {
      dragState.current.hasMoved = true;
    }

    updateButtonPosition(newX, newY);
  };

  const handleTouchEnd = (e) => {
    if (!dragState.current.isDragging) return;

    const wasDragging = dragState.current.hasMoved;

    if (wasDragging) {
      // Save final position to state and localStorage
      setPosition({
        x: dragState.current.currentX,
        y: dragState.current.currentY
      });

      e.preventDefault();
      e.stopPropagation();
    }

    setIsDragging(false);
    dragState.current.isDragging = false;
  };

  const handleClick = (e) => {
    // Only trigger onClick if not dragging
    if (!dragState.current.hasMoved) {
      onClick();
    }
  };

  // Only show on mobile when enabled, and when position is initialized
  if (!isMobile || !showFloatingButton || position === null) {
    return null;
  }

  return (
    <button
      ref={buttonRef}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`fixed z-40 text-white rounded-full shadow-lg touch-manipulation flex items-center justify-center ${
        isDragging
          ? 'bg-blue-600/70 scale-110 cursor-grabbing'
          : 'bg-blue-600/60 hover:bg-blue-600/80 active:bg-blue-600/90 active:scale-95 transition-all duration-200 cursor-grab'
      }`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '52px',
        height: '52px',
        backdropFilter: isDragging ? 'none' : 'blur(8px)',
        WebkitBackdropFilter: isDragging ? 'none' : 'blur(8px)',
        willChange: isDragging ? 'left, top' : 'auto',
        transition: isDragging ? 'none' : undefined
      }}
      aria-label="Open sidebar"
    >
      <Menu className="w-6 h-6" />
    </button>
  );
}

export default FloatingSidebarButton;
