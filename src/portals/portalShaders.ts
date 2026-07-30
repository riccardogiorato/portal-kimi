/**
 * portals/portalShaders.ts — GLSL for the portal surface.
 *
 * One ShaderMaterial per portal. When linked, the surface samples the OTHER
 * portal's RenderTargetTexture in screen space (the classic portal technique:
 * the RTT was rendered by a virtual camera mirrored through the pair, so
 * sampling by gl_FragCoord produces a seamless see-through view). A swirl
 * distortion + rim glow keeps it alive. When unlinked, a procedural spiral
 * vortex of the portal's color plays instead.
 */

export const PORTAL_VERTEX = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 worldViewProjection;

varying vec2 vUV;

void main(void) {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

export const PORTAL_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUV;

uniform sampler2D rttSampler;
uniform vec2 viewportSize;
uniform vec3 portalColor;
uniform float time;
uniform float linked; // 1.0 = sample the linked RTT, 0.0 = vortex

void main(void) {
  vec2 centered = vUV * 2.0 - 1.0; // ellipse-local [-1, 1]
  float r = length(centered);

  // Swirl: small rotating screen-space distortion, stronger near the rim.
  float ang = time * 1.7 + r * 6.0;
  vec2 swirl = vec2(cos(ang), sin(ang)) * 0.006 * (1.0 - clamp(r, 0.0, 1.0));

  vec3 linkedView = texture2D(rttSampler, gl_FragCoord.xy / viewportSize + swirl).rgb;

  // Unlinked vortex: three-arm spiral, dark heart, bright rim.
  float a = atan(centered.y, centered.x);
  float spiral = sin(a * 3.0 + time * 4.0 - r * 10.0) * 0.5 + 0.5;
  vec3 vortex = portalColor * (0.22 + spiral * 0.78) * (1.0 - r * 0.55);

  vec3 body = mix(vortex, linkedView, linked);

  // Energetic rim: the last 25% of the radius blooms in the portal color.
  float rim = smoothstep(0.72, 1.0, r);
  vec3 col = mix(body, portalColor * 2.2, rim * 0.85);

  gl_FragColor = vec4(col, 1.0);
}
`;
