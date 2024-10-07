import * as THREE from 'three';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Constants and Settings
const CHUNK_SIZE = 10;
const RENDER_DISTANCE = 3;
const GRID_DIVISIONS = 15;
const HEIGHT_SCALE = 3;
const MOVE_SPEED = 5;
const TURN_SPEED = 3 * Math.PI;
const REST_THRESHOLD = 0.2;
const CAMERA_OFFSET = new THREE.Vector3(5, 5, 5);

// Scene Setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
const clock = new THREE.Clock();

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);

// Character and Animation
let character, mixer, currentAction;
const animations = {};
const keyState = {};
const loader = new GLTFLoader();
let lastMovementTime = 0;

// Terrain
const chunks = new Map();
const noise = new ImprovedNoise();

// Initialize the application
async function init() {
    setupRenderer();
    setupLighting();
    setupCamera();
    setupEventListeners();
    await loadCharacter();
    animate();
}

function setupRenderer() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);
}

function setupLighting() {
    scene.background = new THREE.Color(0xFFFFFF);
    scene.add(ambientLight);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    scene.add(hemisphereLight);
}

function setupCamera() {
    camera.position.set(5, 5, 5);
}

function setupEventListeners() {
    document.addEventListener('keydown', (event) => { keyState[event.code] = true; });
    document.addEventListener('keyup', (event) => { keyState[event.code] = false; });
    window.addEventListener('resize', onWindowResize, false);
}

function loadCharacter() {
    return new Promise((resolve, reject) => {
        loader.setPath('../models/')
        loader.load('Soldier.glb', (gltf) => {
            character = gltf.scene;
            scene.add(character);
            character.scale.set(1, 1, 1);
            character.traverse(object => { if (object.isMesh) object.castShadow = true; });
            
            const box = new THREE.Box3().setFromObject(character);
            const center = box.getCenter(new THREE.Vector3());
            character.position.sub(center);
            character.position.y = getNoiseHeight(0, 0) + 1;
            
            mixer = new THREE.AnimationMixer(character);
            gltf.animations.forEach((clip) => {
                animations[clip.name] = mixer.clipAction(clip);
            });
            
            if (animations['Idle']) {
                currentAction = animations['Idle'];
                currentAction.play();
            }
            resolve();
        },
        (xhr) => console.log((xhr.loaded / xhr.total * 100) + '% loaded'),
        (error) => {
            console.error('An error happened', error);
            reject(error);
        });
    })
}

function getNoiseHeight(x, z) {
    const scale = 0.1;
    return HEIGHT_SCALE * noise.noise(x * scale, 0, z * scale);
}

function createChunk(x, z) {
    const chunkGroup = new THREE.Group();
    
    for (let i = 0; i <= GRID_DIVISIONS; i++) {
        const lineGeometry1 = new THREE.BufferGeometry();
        const lineGeometry2 = new THREE.BufferGeometry();
        const positions1 = [];
        const positions2 = [];

        for (let j = 0; j <= GRID_DIVISIONS; j++) {
            const x1 = (i / GRID_DIVISIONS) * CHUNK_SIZE;
            const z1 = (j / GRID_DIVISIONS) * CHUNK_SIZE;
            const y1 = getNoiseHeight(x * CHUNK_SIZE + x1, z * CHUNK_SIZE + z1);

            const x2 = (j / GRID_DIVISIONS) * CHUNK_SIZE;
            const z2 = (i / GRID_DIVISIONS) * CHUNK_SIZE;
            const y2 = getNoiseHeight(x * CHUNK_SIZE + x2, z * CHUNK_SIZE + z2);

            positions1.push(x1, y1, z1);
            positions2.push(x2, y2, z2);
        }

        lineGeometry1.setAttribute('position', new THREE.Float32BufferAttribute(positions1, 3));
        lineGeometry2.setAttribute('position', new THREE.Float32BufferAttribute(positions2, 3));

        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x888888 });
        chunkGroup.add(new THREE.Line(lineGeometry1, lineMaterial));
        chunkGroup.add(new THREE.Line(lineGeometry2, lineMaterial));
    }

    chunkGroup.position.set(x * CHUNK_SIZE, 0, z * CHUNK_SIZE);
    return chunkGroup;
}

function updateChunks() {
    const playerChunkX = Math.floor(character.position.x / CHUNK_SIZE);
    const playerChunkZ = Math.floor(character.position.z / CHUNK_SIZE);

    for (let x = playerChunkX - RENDER_DISTANCE; x <= playerChunkX + RENDER_DISTANCE; x++) {
        for (let z = playerChunkZ - RENDER_DISTANCE; z <= playerChunkZ + RENDER_DISTANCE; z++) {
            const chunkKey = `${x},${z}`;
            if (!chunks.has(chunkKey)) {
                const chunk = createChunk(x, z);
                chunks.set(chunkKey, chunk);
                scene.add(chunk);
            }
        }
    }

    for (const [key, chunk] of chunks) {
        const [chunkX, chunkZ] = key.split(',').map(Number);
        if (Math.abs(chunkX - playerChunkX) > RENDER_DISTANCE || 
            Math.abs(chunkZ - playerChunkZ) > RENDER_DISTANCE) {
            scene.remove(chunk);
            chunks.delete(key);
        }
    }
}

function moveCharacter(deltaTime) {
    if (!character || !mixer) return;

    const moveVector = new THREE.Vector3();
    let isMoving = false;

    if (keyState['ArrowUp'] || keyState['KeyW']) { moveVector.z -= 1; moveVector.x -= 1; isMoving = true; }
    if (keyState['ArrowDown'] || keyState['KeyS']) { moveVector.z += 1; moveVector.x += 1; isMoving = true; }
    if (keyState['ArrowLeft'] || keyState['KeyA']) { moveVector.z += 1; moveVector.x -= 1; isMoving = true; }
    if (keyState['ArrowRight'] || keyState['KeyD']) { moveVector.z -= 1; moveVector.x += 1; isMoving = true; }

    if (isMoving) {
        moveVector.normalize();
        
        const targetRotation = Math.atan2(-moveVector.x, -moveVector.z);
        let rotationDiff = targetRotation - character.rotation.y;
        rotationDiff = Math.atan2(Math.sin(rotationDiff), Math.cos(rotationDiff));

        const rotationStep = TURN_SPEED * deltaTime;
        character.rotation.y += Math.abs(rotationDiff) < rotationStep ? rotationDiff : Math.sign(rotationDiff) * rotationStep;
        
        const movement = moveVector.multiplyScalar(MOVE_SPEED * deltaTime);
        character.position.add(movement);
        
        const terrainHeight = getNoiseHeight(character.position.x, character.position.z);
        character.position.y = terrainHeight + 1;

        fadeToAction(animations['Walk'], 0.1);
        lastMovementTime = performance.now();
    } else if (performance.now() - lastMovementTime > REST_THRESHOLD * 1000) {
        fadeToAction(animations['Idle'], 0.1);
    }

    mixer.update(deltaTime);
}

function fadeToAction(newAction, duration = 0.5) {
    if (currentAction === newAction) return;

    newAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(duration);
    if (currentAction) currentAction.fadeOut(duration);
    currentAction = newAction;
    currentAction.play();
}

function updateCamera() {
    if (!character) return;
    camera.position.copy(character.position).add(CAMERA_OFFSET);
    camera.lookAt(character.position);
}

function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    moveCharacter(deltaTime);
    updateCamera();
    updateChunks();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => console.error('Initialization error:', error));
});