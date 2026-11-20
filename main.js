const vertexSource = `#version 300 es
in vec2 aPosition;

void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const fragmentSource = `#version 300 es
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform int u_maxBounces;
uniform int u_samples;
uniform float u_ambientStrength;
uniform vec3 u_cameraPos;
uniform mat3 u_cameraRot;

out vec4 fragColor;

const float EPSILON = 0.001;
const float FAR = 1e10;
const float FLOOR_Y = -2.0;
const float CHECKER_SIZE = 3.0;
const float GLASS_IOR = 1.5;
const int OPAQUE = 0;
const int LIGHT = 1;
const int GLASS = 2;

struct Ray {
    vec3 origin;
    vec3 direction;
};

struct Light {
    vec3 center;
    float radius;
    vec3 color;
    vec3 diffuseColor;
    float power;
};

struct Sphere {
    vec3 center;
    float radius;
    vec3 color;
    float reflectivity;
};

struct Cube {
    vec3 center;
    float halfSize;
    vec3 color;
    float reflectivity;
};

struct Cylinder {
    vec3 center;
    float radius;
    float halfHeight;
    vec3 color;
    float reflectivity;
};

struct Hit {
    float t;
    vec3 normal;
    vec3 color;
    float reflectivity;
    int material;
};

const vec3 FILL_COLOR = vec3(0.75, 0.85, 1.0);
const Light lights[2] = Light[2](
    Light(vec3(4.0, 3.0, -4.0), 0.3, vec3(1.0, 1.0, 0.9), vec3(1.0), 3.0),
    Light(vec3(-3.0, 2.0, -5.0), 0.3, FILL_COLOR, FILL_COLOR, 1.0)
);
const Cylinder cylinder = Cylinder(vec3(3.1, -1.0, -4.4), 0.65, 1.0, vec3(0.25, 0.55, 1.0), 0.25);
Sphere redSphere;
Sphere glassSphere;
Cube cube;

void moveObjects(float time) {
    float sphereTime = time * 0.5;
    vec3 sphereCenter = vec3(
        2.5 * cos(sphereTime),
        0.8 * sin(1.3 * sphereTime),
        -6.0 + 0.5 * sin(sphereTime)
    );
    redSphere = Sphere(sphereCenter, 1.0, vec3(1.0, 0.3, 0.3), 0.1);

    float cubeTime = time * 0.3;
    vec3 cubeCenter = vec3(
        2.0 * sin(cubeTime),
        0.5 + cos(1.5 * cubeTime),
        -9.0 + cos(0.7 * cubeTime)
    );
    cube = Cube(cubeCenter, 0.8, vec3(0.3, 0.8, 0.3), 0.85);
    glassSphere = Sphere(vec3(sin(time * 0.4), -0.2, -3.4), 1.0, vec3(0.95, 0.98, 1.0), 0.0);
}

bool intersectSphere(Ray ray, vec3 center, float radius, out float t) {
    vec3 start = ray.origin - center;
    float b = dot(start, ray.direction);
    float c = dot(start, start) - radius * radius;
    float discriminant = b * b - c;
    if (discriminant < 0.0) return false;

    float root = sqrt(discriminant);
    t = -b - root;
    if (t < EPSILON) t = -b + root;
    return t > EPSILON;
}

bool intersectCube(Ray ray, out float t, out vec3 normal) {
    vec3 start = ray.origin - cube.center;
    float nearT = -FAR;
    float farT = FAR;

    for (int axis = 0; axis < 3; axis++) {
        float direction = ray.direction[axis];
        if (direction == 0.0) {
            if (abs(start[axis]) > cube.halfSize) return false;
            continue;
        }

        float first = (-cube.halfSize - start[axis]) / direction;
        float second = (cube.halfSize - start[axis]) / direction;
        nearT = max(nearT, min(first, second));
        farT = min(farT, max(first, second));
        if (nearT > farT) return false;
    }

    t = nearT > EPSILON ? nearT : farT;
    if (t < EPSILON) return false;

    vec3 point = start + t * ray.direction;
    vec3 extent = abs(point);
    if (extent.x > extent.y && extent.x > extent.z) {
        normal = vec3(sign(point.x), 0.0, 0.0);
    } else if (extent.y > extent.z) {
        normal = vec3(0.0, sign(point.y), 0.0);
    } else {
        normal = vec3(0.0, 0.0, sign(point.z));
    }
    return true;
}

bool intersectCylinder(Ray ray, out float t, out vec3 normal) {
    vec3 start = ray.origin - cylinder.center;
    vec3 direction = ray.direction;
    float radiusSquared = cylinder.radius * cylinder.radius;
    t = FAR;
    normal = vec3(0.0);

    float a = dot(direction.xz, direction.xz);
    float b = dot(start.xz, direction.xz);
    float c = dot(start.xz, start.xz) - radiusSquared;
    float discriminant = b * b - a * c;
    if (a > 0.00001 && discriminant >= 0.0) {
        float root = sqrt(discriminant);
        vec2 roots = vec2(-b - root, -b + root) / a;
        for (int i = 0; i < 2; i++) {
            float candidate = roots[i];
            vec3 point = start + candidate * direction;
            if (candidate > EPSILON && candidate < t && abs(point.y) <= cylinder.halfHeight) {
                t = candidate;
                normal = vec3(point.x, 0.0, point.z) / cylinder.radius;
            }
        }
    }

    if (abs(direction.y) > 0.0001) {
        for (int cap = 0; cap < 2; cap++) {
            float side = cap == 0 ? 1.0 : -1.0;
            float candidate = (side * cylinder.halfHeight - start.y) / direction.y;
            vec2 point = start.xz + candidate * direction.xz;
            if (candidate > EPSILON && candidate < t && dot(point, point) <= radiusSquared) {
                t = candidate;
                normal = vec3(0.0, side, 0.0);
            }
        }
    }
    return t < FAR;
}

Hit closestHit(Ray ray, bool includeLights) {
    Hit hit = Hit(FAR, vec3(0.0), vec3(0.0), 0.0, OPAQUE);
    float t;
    vec3 normal;

    if (includeLights) {
        for (int i = 0; i < lights.length(); i++) {
            Light light = lights[i];
            if (intersectSphere(ray, light.center, light.radius, t) && t < hit.t) {
                hit = Hit(t, vec3(0.0), light.color * light.power, 0.0, LIGHT);
            }
        }
    }

    if (abs(ray.direction.y) >= 0.0001) {
        t = (FLOOR_Y - ray.origin.y) / ray.direction.y;
        if (t > EPSILON && t < hit.t) {
            vec3 point = ray.origin + t * ray.direction;
            vec2 cell = floor(point.xz / CHECKER_SIZE);
            float shade = mod(cell.x + cell.y, 2.0) < 1.0 ? 1.0 : 0.05;
            hit = Hit(t, vec3(0.0, 1.0, 0.0), vec3(shade), 0.12, OPAQUE);
        }
    }

    if (intersectCube(ray, t, normal) && t < hit.t) {
        hit = Hit(t, normal, cube.color, cube.reflectivity, OPAQUE);
    }
    if (intersectCylinder(ray, t, normal) && t < hit.t) {
        hit = Hit(t, normal, cylinder.color, cylinder.reflectivity, OPAQUE);
    }
    if (intersectSphere(ray, redSphere.center, redSphere.radius, t) && t < hit.t) {
        vec3 point = ray.origin + t * ray.direction;
        normal = (point - redSphere.center) / redSphere.radius;
        hit = Hit(t, normal, redSphere.color, redSphere.reflectivity, OPAQUE);
    }
    if (intersectSphere(ray, glassSphere.center, glassSphere.radius, t) && t < hit.t) {
        vec3 point = ray.origin + t * ray.direction;
        normal = (point - glassSphere.center) / glassSphere.radius;
        hit = Hit(t, normal, glassSphere.color, 0.0, GLASS);
    }
    return hit;
}

vec3 reflectRay(vec3 direction, vec3 normal) {
    return direction - 2.0 * dot(direction, normal) * normal;
}

vec3 refractRay(vec3 direction, vec3 normal, float eta) {
    float incidence = dot(direction, normal);
    float k = 1.0 - eta * eta * (1.0 - incidence * incidence);
    if (k < 0.0) return vec3(0.0);
    return eta * direction - (eta * incidence + sqrt(k)) * normal;
}

float schlick(float cosine, float eta) {
    float base = (1.0 - eta) / (1.0 + eta);
    base *= base;
    float grazing = 1.0 - cosine;
    float factor = grazing * grazing * grazing * grazing * grazing;
    return base + (1.0 - base) * factor;
}

float random(inout float seed) {
    seed += 1.0;
    return fract(sin(seed * 12.9898 + 78.233) * 43758.5453);
}

vec3 glassHighlight(vec3 point, vec3 normal, vec3 view) {
    vec3 highlight = vec3(0.0);
    for (int i = 0; i < lights.length(); i++) {
        Light light = lights[i];
        vec3 toLight = light.center - point;
        float lightDistance = length(toLight);
        vec3 lightDirection = toLight / lightDistance;
        vec3 reflectedLight = reflectRay(-lightDirection, normal);
        float alignment = dot(view, reflectedLight);
        if (alignment <= 0.0) continue;

        Hit blocker = closestHit(Ray(point + 2.0 * EPSILON * normal, lightDirection), false);
        if (blocker.t < lightDistance) continue;

        float specular = pow(alignment, 64.0);
        float falloff = 1.0 / (1.0 + 0.1 * lightDistance * lightDistance);
        highlight += light.color * (light.power * 0.85 * specular * falloff);
    }
    return highlight;
}

vec3 phong(Hit hit, vec3 point, vec3 view) {
    vec3 shading = u_ambientStrength * hit.color;
    for (int i = 0; i < lights.length(); i++) {
        Light light = lights[i];
        vec3 toLight = light.center - point;
        float lightDistance = length(toLight);
        vec3 lightDirection = toLight / lightDistance;
        float diffuse = dot(hit.normal, lightDirection);
        if (diffuse <= 0.0) continue;

        Hit blocker = closestHit(Ray(point + EPSILON * hit.normal, lightDirection), false);
        float visibility = 1.0;
        if (blocker.t < lightDistance) {
            visibility = blocker.material == GLASS ? 0.65 : 0.0;
        }

        float falloff = 1.0 / (1.0 + 0.1 * lightDistance * lightDistance);
        float intensity = light.power * falloff * visibility;
        vec3 reflectedLight = reflectRay(-lightDirection, hit.normal);
        float specular = pow(max(dot(view, reflectedLight), 0.0), 32.0);
        shading += hit.color * light.diffuseColor * (intensity * diffuse);
        shading += light.color * (0.5 * intensity * specular);
    }
    return shading;
}

vec3 trace(Ray ray, inout float seed) {
    vec3 color = vec3(0.0);
    vec3 attenuation = vec3(1.0);

    for (int bounce = 0; bounce < 8; bounce++) {
        if (bounce >= u_maxBounces) break;
        Hit hit = closestHit(ray, true);

        if (hit.t == FAR) {
            float height = 0.5 * (ray.direction.y + 1.0);
            vec3 sky = mix(vec3(0.09, 0.12, 0.18), vec3(0.18, 0.21, 0.27), height);
            color += attenuation * sky;
            break;
        }
        if (hit.material == LIGHT) {
            color += attenuation * hit.color;
            break;
        }

        vec3 point = ray.origin + hit.t * ray.direction;
        if (hit.material == GLASS) {
            bool entering = dot(ray.direction, hit.normal) < 0.0;
            vec3 normal = entering ? hit.normal : -hit.normal;
            float eta = entering ? 1.0 / GLASS_IOR : GLASS_IOR;

            if (entering) {
                color += attenuation * glassHighlight(point, normal, -ray.direction);
            } else {
                attenuation /= 1.0 + hit.t * vec3(0.08, 0.03, 0.01);
            }

            vec3 transmitted = refractRay(ray.direction, normal, eta);
            bool useReflection = dot(transmitted, transmitted) < 0.0001;
            if (!useReflection) {
                float cosine = entering ? dot(-ray.direction, normal) : dot(transmitted, -normal);
                float chance = schlick(min(cosine, 1.0), eta);
                useReflection = u_samples <= 1 ? chance > 0.5 : random(seed) < chance;
            }

            vec3 nextDirection = useReflection ? reflectRay(ray.direction, normal) : transmitted;
            float side = dot(nextDirection, normal) > 0.0 ? 1.0 : -1.0;
            ray = Ray(point + side * 2.0 * EPSILON * normal, nextDirection);
            attenuation *= hit.color;
            continue;
        }

        vec3 shading = phong(hit, point, -ray.direction);
        color += attenuation * shading * (1.0 - hit.reflectivity);
        if (hit.reflectivity == 0.0) break;

        attenuation *= hit.reflectivity;
        ray = Ray(point + EPSILON * hit.normal, reflectRay(ray.direction, hit.normal));
    }

    return color;
}

void main() {
    moveObjects(u_time);
    vec3 color = vec3(0.0);

    for (int sampleIndex = 0; sampleIndex < 8; sampleIndex++) {
        if (sampleIndex >= u_samples) break;
        float seed = 1973.0 * gl_FragCoord.x + 9277.0 * gl_FragCoord.y + 26699.0 * float(sampleIndex);
        vec2 jitter = vec2(0.0);
        if (u_samples > 1) {
            float x = random(seed);
            float y = random(seed);
            jitter = vec2(x, y) - 0.5;
        }

        vec2 uv = (gl_FragCoord.xy + jitter - 0.5 * u_resolution) / u_resolution.y;
        vec3 direction = u_cameraRot * normalize(vec3(uv, -1.5));
        color += trace(Ray(u_cameraPos, direction), seed);
    }

    fragColor = vec4(pow(color / float(u_samples), vec3(1.0 / 2.2)), 1.0);
}
`;

const canvas = document.getElementById("glcanvas");
const vertexEditor = document.getElementById("vertEditor");
const fragmentEditor = document.getElementById("fragEditor");
const shaderError = document.getElementById("shaderError");
const bounces = document.getElementById("bounces");
const samples = document.getElementById("samples");
const ambient = document.getElementById("ambient");
const gl = canvas.getContext("webgl2");

let program = null;
let pitch = 0;
let yaw = 0;
let targetX = 0;
let targetY = 0;
let cameraDistance = 7;

function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;

    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || "The shader could not be compiled.");
}

function linkShaders() {
    const vertex = compileShader(gl.VERTEX_SHADER, vertexEditor.value);
    let fragment;
    try {
        fragment = compileShader(gl.FRAGMENT_SHADER, fragmentEditor.value);
        const nextProgram = gl.createProgram();
        gl.attachShader(nextProgram, vertex);
        gl.attachShader(nextProgram, fragment);
        gl.bindAttribLocation(nextProgram, 0, "aPosition");
        gl.linkProgram(nextProgram);
        if (gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) return nextProgram;

        const message = gl.getProgramInfoLog(nextProgram);
        gl.deleteProgram(nextProgram);
        throw new Error(message || "The shaders could not be linked.");
    } finally {
        gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
    }
}

function updateShaders() {
    try {
        const nextProgram = linkShaders();
        gl.useProgram(nextProgram);
        gl.deleteProgram(program);
        program = nextProgram;
        shaderError.textContent = "";
    } catch (error) {
        shaderError.textContent = error.message.replace(/\0/g, "");
    }
}

function moveCamera(event) {
    if (event.target === vertexEditor || event.target === fragmentEditor) return;

    const step = 0.25;
    switch (event.key) {
        case "ArrowLeft":
            targetX -= step;
            break;
        case "ArrowRight":
            targetX += step;
            break;
        case "ArrowUp":
            targetY += step;
            break;
        case "ArrowDown":
            targetY -= step;
            break;
        case "w":
            cameraDistance = Math.max(2, cameraDistance - step);
            break;
        case "s":
            cameraDistance = Math.min(18, cameraDistance + step);
            break;
        default:
            return;
    }
    event.preventDefault();
}

function render(time) {
    requestAnimationFrame(render);
    if (!program) return;

    const rotation = multiply3(rotateY3(yaw), rotateX3(pitch));
    const [x, y, z] = transformVec3(rotation, [0, 0, cameraDistance]);
    const position = [targetX + x, targetY + y, -5 + z];
    const uniform = name => gl.getUniformLocation(program, name);

    gl.uniform1f(uniform("u_time"), time / 1000);
    gl.uniform2f(uniform("u_resolution"), canvas.width, canvas.height);
    gl.uniform1i(uniform("u_maxBounces"), Number(bounces.value));
    gl.uniform1i(uniform("u_samples"), Number(samples.value));
    gl.uniform1f(uniform("u_ambientStrength"), Number(ambient.value));
    gl.uniform3fv(uniform("u_cameraPos"), position);
    gl.uniformMatrix3fv(uniform("u_cameraRot"), false, rotation);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function start() {
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    vertexEditor.value = vertexSource;
    fragmentEditor.value = fragmentSource;
    vertexEditor.addEventListener("input", updateShaders);
    fragmentEditor.addEventListener("input", updateShaders);
    updateShaders();

    for (const slider of [bounces, ambient, samples]) {
        const readout = document.getElementById(slider.id + "Value");
        slider.addEventListener("input", () => {
            readout.textContent = slider.value;
        });
    }

    canvas.addEventListener("pointerdown", event => canvas.setPointerCapture(event.pointerId));
    canvas.addEventListener("pointermove", event => {
        if (!canvas.hasPointerCapture(event.pointerId)) return;
        yaw -= event.movementX * 0.01;
        pitch = Math.min(1.4, Math.max(-0.2, pitch + event.movementY * 0.01));
    });
    document.addEventListener("keydown", moveCamera);
    requestAnimationFrame(render);
}

if (gl) {
    start();
} else {
    shaderError.textContent = "WebGL 2 is required to run the ray tracer.";
}
