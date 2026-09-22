import { gsap } from 'gsap';
import { useEffect } from 'react';

import './MagicBento.css';

const GLOW_COLOR = '33, 122, 84';
const PARTICLE_COUNT = 8;

const createParticle = (card, color) => {
  const particle = document.createElement('span');
  particle.className = 'magic-bento-particle';
  particle.style.setProperty('--particle-color', `rgba(${color}, 1)`);
  particle.style.left = `${Math.random() * 100}%`;
  particle.style.top = `${Math.random() * 100}%`;
  card.appendChild(particle);

  gsap.fromTo(particle, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.28, ease: 'back.out(1.7)' });
  gsap.to(particle, {
    x: (Math.random() - 0.5) * 90,
    y: (Math.random() - 0.5) * 90,
    duration: 1.8 + Math.random() * 1.8,
    ease: 'none',
    repeat: -1,
    yoyo: true
  });
  gsap.to(particle, { opacity: 0.25, duration: 1.2, ease: 'sine.inOut', repeat: -1, yoyo: true });
  return particle;
};

const addRipple = (card, event, color) => {
  const rect = card.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const radius = Math.max(
    Math.hypot(x, y),
    Math.hypot(x - rect.width, y),
    Math.hypot(x, y - rect.height),
    Math.hypot(x - rect.width, y - rect.height)
  );
  const ripple = document.createElement('span');
  ripple.className = 'magic-bento-ripple';
  ripple.style.cssText = `width:${radius * 2}px;height:${radius * 2}px;left:${x - radius}px;top:${y - radius}px;background:radial-gradient(circle, rgba(${color}, 0.34), rgba(${color}, 0.12) 35%, transparent 70%);`;
  card.appendChild(ripple);
  gsap.fromTo(ripple, { scale: 0, opacity: 1 }, {
    scale: 1,
    opacity: 0,
    duration: 0.75,
    ease: 'power2.out',
    onComplete: () => ripple.remove()
  });
};

const getTiles = root => [...root.querySelectorAll('main [class*="rounded-3xl"], main [class*="rounded-[28px]"]')];

export default function MagicBento({
  glowColor = GLOW_COLOR,
  particleCount = PARTICLE_COUNT,
  enableTilt = true,
  enableMagnetism = true,
  enableSpotlight = true,
  clickEffect = true
}) {
  useEffect(() => {
    const root = document.querySelector('.app-shell-inner');
    if (!root) return undefined;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = window.matchMedia('(max-width: 767px)');
    const cleanups = new Map();

    const syncTiles = () => {
      if (reduceMotion.matches || mobile.matches) return;
      getTiles(root).forEach(card => {
        if (card.dataset.magicBentoBound === 'true') return;
        card.dataset.magicBentoBound = 'true';
        card.classList.add('magic-bento-card');
        card.style.setProperty('--magic-glow-color', glowColor);
        card.style.setProperty('--magic-particle-count', particleCount);

        const handleEnter = () => {
          card.classList.add('magic-bento-card--active');
          for (let index = 0; index < particleCount; index += 1) createParticle(card, glowColor);
        };
        const handleMove = event => {
          const rect = card.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          card.style.setProperty('--magic-glow-x', `${(x / rect.width) * 100}%`);
          card.style.setProperty('--magic-glow-y', `${(y / rect.height) * 100}%`);

          if (enableTilt) {
            gsap.to(card, {
              rotateX: ((y - rect.height / 2) / (rect.height / 2)) * -3,
              rotateY: ((x - rect.width / 2) / (rect.width / 2)) * 3,
              duration: 0.18,
              ease: 'power2.out',
              transformPerspective: 900
            });
          }
          if (enableMagnetism) {
            gsap.to(card, {
              x: (x - rect.width / 2) * 0.018,
              y: (y - rect.height / 2) * 0.018,
              duration: 0.25,
              ease: 'power2.out'
            });
          }
        };
        const handleLeave = () => {
          card.classList.remove('magic-bento-card--active');
          card.querySelectorAll('.magic-bento-particle').forEach(particle => {
            gsap.to(particle, { scale: 0, opacity: 0, duration: 0.2, onComplete: () => particle.remove() });
          });
          gsap.to(card, { rotateX: 0, rotateY: 0, x: 0, y: 0, duration: 0.3, ease: 'power2.out' });
        };
        const handleClick = event => {
          if (clickEffect) addRipple(card, event, glowColor);
        };

        card.addEventListener('mouseenter', handleEnter);
        card.addEventListener('mousemove', handleMove);
        card.addEventListener('mouseleave', handleLeave);
        card.addEventListener('click', handleClick);
        cleanups.set(card, () => {
          delete card.dataset.magicBentoBound;
          card.removeEventListener('mouseenter', handleEnter);
          card.removeEventListener('mousemove', handleMove);
          card.removeEventListener('mouseleave', handleLeave);
          card.removeEventListener('click', handleClick);
          card.querySelectorAll('.magic-bento-particle, .magic-bento-ripple').forEach(node => node.remove());
          gsap.killTweensOf(card);
        });
      });
    };

    const handleSpotlight = event => {
      if (!enableSpotlight || reduceMotion.matches || mobile.matches) return;
      getTiles(root).forEach(card => {
        const rect = card.getBoundingClientRect();
        const distanceX = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
        const distanceY = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
        const distance = Math.hypot(distanceX, distanceY);
        const intensity = Math.max(0, 1 - distance / 300);
        card.style.setProperty('--magic-glow-intensity', intensity.toFixed(2));
        if (intensity > 0) {
          card.style.setProperty('--magic-glow-x', `${((event.clientX - rect.left) / rect.width) * 100}%`);
          card.style.setProperty('--magic-glow-y', `${((event.clientY - rect.top) / rect.height) * 100}%`);
        }
      });
    };

    syncTiles();
    const observer = new MutationObserver(syncTiles);
    observer.observe(root, { childList: true, subtree: true });
    document.addEventListener('mousemove', handleSpotlight);

    return () => {
      observer.disconnect();
      document.removeEventListener('mousemove', handleSpotlight);
      cleanups.forEach(cleanup => cleanup());
      cleanups.clear();
    };
  }, [clickEffect, enableMagnetism, enableSpotlight, enableTilt, glowColor, particleCount]);

  return null;
}
