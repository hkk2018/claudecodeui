import React from 'react';

const ClaudeLogo = ({className = 'w-5 h-5', size}: {className?: string; size?: number}) => {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <img src="/icons/claude-ai-icon.svg" alt="Claude" className={className} style={style} />
  );
};

export default ClaudeLogo;


