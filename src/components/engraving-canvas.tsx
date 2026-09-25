"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTheme } from "@/components/theme-provider";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ShaderMaterial } from "three";
import { Vector2, Vector3 } from "three";

const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uAspect;
  uniform float uPointerEnergy;
  uniform float uStrength;
  uniform vec2 uPointer;
  uniform vec3 uInk;

  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;

    for (int i = 0; i < 4; i++) {
      sum += valueNoise(p) * amplitude;
      p *= 2.03;
      amplitude *= 0.5;
    }

    return sum;
  }

  void main() {
    vec2 p = vUv - 0.5;
    p.x *= uAspect;
    float t = uTime;

    vec2 pointer = uPointer - 0.5;
    pointer.x *= uAspect;
    vec2 fromPointer = p - pointer;
    float lens = exp(-dot(fromPointer, fromPointer) * 7.0);

    float wide = smoothstep(1.6, 2.3, uAspect);

    // Warping the sample position makes contours drift and braid
    // instead of marching past as parallel stripes.
    vec2 warp = vec2(
      fbm(p * 1.5 + vec2(t * 0.045, 0.0)),
      fbm(p * 1.5 + vec2(4.7, 2.1) - vec2(0.0, t * 0.035))
    );

    // A narrow hero gets a coarser field, so the watermark behind the copy
    // reads as texture instead of hatching.
    float height = fbm(p * mix(1.1, 1.7, wide) + warp * 0.85);
    height += p.y * 0.62;
    height += lens * (0.05 + uPointerEnergy * 0.12);

    float contours = height * mix(15.0, 26.0, wide);
    float distanceToLine = abs(fract(contours) - 0.5);

    // fwidth keeps every line one hairline wide, however steep the field.
    float lineWidth = max(fwidth(contours), 1e-4);
    float line =
      1.0 - smoothstep(lineWidth * 0.7, lineWidth * 2.1, distanceToLine);

    // On a wide hero the copy sits to the left, so the field dissolves
    // sideways to clear it. Once the hero stacks there is no free column and
    // it drops back to a watermark behind the text.
    float reveal = mix(
      smoothstep(0.0, 0.5, 1.0 - vUv.y),
      smoothstep(0.34, 0.86, vUv.x),
      wide
    );

    float fade =
      reveal *
      smoothstep(0.0, 0.06, 1.0 - vUv.x) *
      smoothstep(0.0, 0.16, vUv.y) *
      smoothstep(0.0, 0.26, 1.0 - vUv.y);

    float weight = mix(0.2, 0.82, wide) * uStrength;
    float alpha = clamp(line * fade * (weight + lens * 0.18), 0.0, 1.0);

    gl_FragColor = vec4(uInk * alpha, alpha);
  }
`;

// The dark ink sits far further from its paper than the light one does, so it
// needs less alpha to land at the same perceived weight.
// Both inks are `--brand` per theme, restated as floats: a shader uniform
// cannot read the custom property, so a change there belongs here too.
const lightField = { ink: [107 / 255, 128 / 255, 114 / 255] as const, strength: 1 };
const darkField = { ink: [148 / 255, 168 / 255, 156 / 255] as const, strength: 0.66 };

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function EngravingPlane({
  dark,
  reducedMotion,
}: {
  dark: boolean;
  reducedMotion: boolean;
}) {
  const materialRef = useRef<ShaderMaterial>(null);
  const pointerTarget = useRef(new Vector2(0.5, 0.5));
  const previousPointer = useRef(new Vector2(0.5, 0.5));
  const pointerEnergy = useRef(0);
  const viewport = useThree((state) => state.viewport);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const field = dark ? darkField : lightField;

  const uniforms = useMemo(
    () => ({
      uTime: { value: 1.4 },
      uAspect: { value: 1.6 },
      uPointerEnergy: { value: 0 },
      uStrength: { value: lightField.strength },
      uPointer: { value: new Vector2(0.5, 0.5) },
      uInk: { value: new Vector3(...lightField.ink) },
    }),
    [],
  );

  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;

    material.uniforms.uInk.value.set(...field.ink);
    material.uniforms.uStrength.value = field.strength;
    invalidate();
  }, [field, invalidate]);

  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;

    if (!reducedMotion) {
      material.uniforms.uTime.value += Math.min(delta, 0.05);
    }

    pointerTarget.current.set(
      state.pointer.x * 0.5 + 0.5,
      state.pointer.y * 0.5 + 0.5,
    );
    const pointerSpeed =
      pointerTarget.current.distanceTo(previousPointer.current) /
      Math.max(delta, 0.001);
    const newEnergy = Math.min(1, pointerSpeed * 0.028);
    pointerEnergy.current = Math.max(
      newEnergy,
      pointerEnergy.current * Math.exp(-delta * 3.8),
    );
    previousPointer.current.copy(pointerTarget.current);

    material.uniforms.uPointer.value.lerp(
      pointerTarget.current,
      1 - Math.exp(-delta * 7),
    );
    material.uniforms.uPointerEnergy.value = pointerEnergy.current;
    material.uniforms.uAspect.value = size.width / Math.max(size.height, 1);
  });

  return (
    <mesh scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

export function EngravingCanvas() {
  const { resolvedTheme } = useTheme();
  const reducedMotion = useReducedMotion();

  return (
    <Canvas
      className="ink-field-canvas"
      camera={{ position: [0, 0, 1], fov: 50 }}
      dpr={[1, 1.75]}
      flat
      frameloop={reducedMotion ? "demand" : "always"}
      fallback={<div className="ink-field-webgl-fallback" aria-hidden />}
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      }}
    >
      <EngravingPlane
        dark={resolvedTheme === "dark"}
        reducedMotion={reducedMotion}
      />
    </Canvas>
  );
}
