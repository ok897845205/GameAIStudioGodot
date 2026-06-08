shader_type spatial;
render_mode blend_mix, depth_draw_always, cull_back, diffuse_lambert, specular_disabled;

// 风格化卡通水面：voronoi 蜂窝泡沫 + 双层正弦波。
// 纯净亮蓝色底色 + 细密白色多边形网格。
// 完全无外部贴图依赖，WebGL/Compatibility 渲染器可直接用。

uniform vec3 water_color : source_color = vec3(0.30, 0.62, 0.92);
uniform vec3 deep_color  : source_color = vec3(0.10, 0.32, 0.66);
uniform vec3 foam_color  : source_color = vec3(0.95, 0.99, 1.00);

uniform float water_alpha : hint_range(0.0, 1.0) = 0.94;
uniform float wave_amp    : hint_range(0.0, 0.6) = 0.10;
uniform float wave_freq   : hint_range(0.05, 4.0) = 0.45;
uniform float wave_speed  : hint_range(0.0, 4.0) = 0.55;

uniform float foam_scale     : hint_range(0.5, 12.0) = 3.5;
uniform float foam_thickness : hint_range(0.005, 0.12) = 0.025;
uniform float foam_softness  : hint_range(0.005, 0.10) = 0.018;
uniform float foam_intensity : hint_range(0.0, 2.0) = 1.10;
uniform float foam_drift     : hint_range(0.0, 1.0) = 0.06;

uniform float fresnel_power    : hint_range(0.5, 8.0) = 3.5;
uniform float fresnel_strength : hint_range(0.0, 1.0) = 0.30;

vec2 hash2(vec2 p) {
	p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
	return fract(sin(p) * 43758.5453);
}

vec2 voronoi_f1f2(vec2 p) {
	vec2 ip = floor(p);
	vec2 fp = fract(p);
	float f1 = 8.0;
	float f2 = 8.0;
	for (int j = -1; j <= 1; j++) {
		for (int i = -1; i <= 1; i++) {
			vec2 g = vec2(float(i), float(j));
			vec2 o = hash2(ip + g);
			vec2 r = g + o - fp;
			float d = dot(r, r);
			if (d < f1) {
				f2 = f1;
				f1 = d;
			} else if (d < f2) {
				f2 = d;
			}
		}
	}
	return vec2(sqrt(f1), sqrt(f2));
}

float wave_height(vec2 p, float t) {
	float a = sin(p.x * wave_freq + t * wave_speed);
	float b = sin((p.x * 0.6 + p.y * 0.8) * wave_freq * 1.7 + t * wave_speed * 1.3);
	float c = sin((p.x * -0.4 + p.y * 1.1) * wave_freq * 0.55 - t * wave_speed * 0.8);
	return (a + b * 0.6 + c * 0.4) / 2.0;
}

void vertex() {
	vec2 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz;
	float h = wave_height(wp, TIME);
	VERTEX.y += h * wave_amp;
	float e = 0.5;
	float hx = wave_height(wp + vec2(e, 0.0), TIME) - h;
	float hz = wave_height(wp + vec2(0.0, e), TIME) - h;
	NORMAL = normalize(vec3(-hx * wave_amp, e, -hz * wave_amp));
}

void fragment() {
	vec3 world_pos = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec2 sample_uv = world_pos.xz * foam_scale * 0.05 + vec2(TIME * foam_drift, TIME * foam_drift * 0.7);

	vec2 f = voronoi_f1f2(sample_uv);
	float edge = f.y - f.x;
	float foam_mask = 1.0 - smoothstep(foam_thickness, foam_thickness + foam_softness, edge);

	vec2 f2 = voronoi_f1f2(sample_uv * 2.7 + vec2(13.1, 7.3));
	float edge2 = f2.y - f2.x;
	float foam_mask2 = 1.0 - smoothstep(foam_thickness * 0.6, foam_thickness * 0.6 + foam_softness * 0.5, edge2);
	foam_mask = max(foam_mask, foam_mask2 * 0.55);

	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), fresnel_power);
	vec3 base = mix(deep_color, water_color, 0.55 + 0.45 * NORMAL.y);
	base = mix(base, water_color * 1.15, fres * fresnel_strength);
	vec3 final_col = mix(base, foam_color, clamp(foam_mask * foam_intensity, 0.0, 1.0));

	float dist_fade = clamp(1.0 - length(VERTEX.xz) / 280.0, 0.0, 1.0);

	ALBEDO = final_col;
	ROUGHNESS = 0.85;
	SPECULAR = 0.15;
	ALPHA = water_alpha * dist_fade;
}
