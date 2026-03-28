import React from 'react';

const CursorLogo = ({ className = 'w-5 h-5', size }: {className?: string; size?: number}) => {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <img src="/icons/cursor.svg" alt="Cursor" className={className} style={style} />
  );
};

export default CursorLogo;
