import { useEffect, useRef } from 'react';
import { Color, PerspectiveCamera, Points, Scene, ShaderMaterial, WebGLRenderer, BufferGeometry, BufferAttribute } from 'three';

import './PixelSnow.css';

const vertexShader = `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uDirection;
  uniform float uMinFlakeSize;
  varying float vDepth;

  void main() {
    vec3 animated = position;
    float depth = (position.z + 10.0) / 20.0;
    float wind = uTime * uSpeed;
    float seed = sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453;
    vec3 random = fract(vec3(seed, seed * 1.37, seed * 2.11));
    float driftAngle = uDirection + (random.x - 0.5) * 2.4;
    float drift = 0.35 + random.y * 0.9;
    float sway = sin(wind * (0.45 + random.z * 0.8) + seed) * (0.18 + random.x * 0.3);
    float tumble = cos(wind * (0.3 + random.y * 0.7) + seed * 0.7) * 0.16;
    animated.x += cos(driftAngle) * wind * drift + sway;
    animated.y += sin(driftAngle) * wind * drift + tumble;
    animated.y -= wind * (0.3 + depth * 0.55);
    animated.x = mod(animated.x + 8.0, 16.0) - 8.0;
    animated.y = mod(animated.y + 8.0, 16.0) - 8.0;

    vec4 mvPosition = modelViewMatrix * vec4(animated, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = max(uMinFlakeSize, 5.5 * (1.0 - depth) + 1.5) * (18.0 / -mvPosition.z);
    vDepth = 1.0 - depth;
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uBrightness;
  uniform float uDensity;
  uniform float uVariant;
  varying float vDepth;

  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float distance = length(point);
    float shape = uVariant < 0.5 ? step(max(abs(point.x), abs(point.y)), 0.46) : step(distance, 0.5);
    float alpha = shape * clamp(vDepth * 1.5, 0.12, 1.0) * uDensity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor * uBrightness, alpha);
  }
`;

const VARIANTS = { square: 0, round: 1, snowflake: 1 };

export default function PixelSnow({
  color = '#ffffff',
  minFlakeSize = 1.25,
  speed = 1.25,
  density = 0.3,
  direction = 125,
  brightness = 1.1,
  variant = 'round',
  className = '',
  style = {}
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const scene = new Scene();
    const camera = new PerspectiveCamera(55, 1, 0.1, 30);
    camera.position.z = 8;
    const renderer = new WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const particleCount = 900;
    const positions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 16;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 16;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 20 - 2;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: speed },
        uDirection: { value: (direction * Math.PI) / 180 },
        uMinFlakeSize: { value: minFlakeSize },
        uColor: { value: new Color(color) },
        uBrightness: { value: brightness },
        uDensity: { value: density },
        uVariant: { value: VARIANTS[variant] ?? 1 }
      }
    });
    scene.add(new Points(geometry, material));

    const resize = () => {
      const width = container.offsetWidth;
      const height = container.offsetHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    let animationId = 0;
    const startedAt = performance.now();
    const animate = now => {
      animationId = requestAnimationFrame(animate);
      material.uniforms.uTime.value = (now - startedAt) * 0.001;
      renderer.render(scene, camera);
    };
    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    };
  }, [brightness, color, density, direction, minFlakeSize, speed, variant]);

  return <div ref={containerRef} className={`pixel-snow-container ${className}`} style={style} />;
}
