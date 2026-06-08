shader_type spatial;
render_mode diffuse_burley, cull_back;

uniform vec3 color_a : source_color = vec3(0.36, 0.4, 0.44);
uniform vec3 color_b : source_color = vec3(0.58, 0.62, 0.66);
// 每米方格数；例如 0.5 = 每格约 2m
uniform float tiles_per_meter : hint_range(0.05, 8.0, 0.05) = 0.5;
uniform float side_shade : hint_range(0.3, 1.0) = 0.72;
uniform float roughness : hint_range(0.0, 1.0) = 0.94;
uniform float metallic : hint_range(0.0, 1.0) = 0.02;

varying vec3 v_world_pos;
varying vec3 v_world_normal;

void vertex() {
	v_world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_world_normal = normalize((MODEL_NORMAL_MATRIX * NORMAL));
}

void fragment() {
	float upf = max(0.0, dot(v_world_normal, vec3(0.0, 1.0, 0.0)));
	vec3 col;
	if (upf > 0.45) {
		float t = tiles_per_meter;
		float p = floor(v_world_pos.x * t) + floor(v_world_pos.z * t);
		// 奇偶棋盘格，负坐标也稳定
		float ch = 0.5 * (1.0 - cos(3.14159265 * p));
		col = mix(color_a, color_b, ch);
	} else {
		col = mix(color_a, color_b, 0.5) * side_shade;
	}
	ALBEDO = col;
	ROUGHNESS = roughness;
	METALLIC = metallic;
}
