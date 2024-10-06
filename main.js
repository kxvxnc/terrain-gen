import * as THREE from 'three';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Set up the scene, camera, and renderer
const scene = new THREE.Scene();
const aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

// Character and Animation
let character;
let mixer;
let animations = {};
let currentAction;
const loader = new GLTFLoader();
function loadCharacter() {
    return new Promise((resolve, reject) => {
        loader.load(
            'Soldier.glb',
            (gltf) => {
                character = gltf.scene;
                character.scale.set(1, 1, 1); // Adjust scale as needed
                
                gltf.scene.traverse((child) => {
                    if (child.isMesh && child.material.map) {
                        child.material.map.onLoad = () => {
                            console.log('Texture loaded for', child.name);
                        };
                        child.material.map.onError = (err) => {
                            console.error('Texture loading error for', child.name, err);
                        };
                    }
                });

                // Center the model
                const box = new THREE.Box3().setFromObject(character);
                const center = box.getCenter(new THREE.Vector3());
                character.position.sub(center);
                
                // Raise the character to stand on the terrain
                character.position.y = getNoiseHeight(0, 0) + 1; // Adjust as needed
                
                scene.add(character);
                
                // Set up animations
                mixer = new THREE.AnimationMixer(character);
                gltf.animations.forEach((clip) => {
                    const action = mixer.clipAction(clip);
                    animations[clip.name] = action;
                });
                
                // Play idle animation by default
                if (animations['Idle']) {
                    animations['Idle'].play();
                }
                
                console.log("Available animations:", Object.keys(animations));
                resolve();
            },
            (xhr) => {
                console.log((xhr.loaded / xhr.total * 100) + '% loaded');
            },
            (error) => {
                console.error('An error happened', error);
                reject(error);
            }
        );
    });
}

// Camera setup
camera.position.set(5, 5, 5);

// Terrain generation
const CHUNK_SIZE = 10;
const RENDER_DISTANCE = 3;
const GRID_DIVISIONS = 15; // Number of grid lines per chunk
const HEIGHT_SCALE = 2; // Adjust for more dramatic height differences
const chunks = new Map();
const noise = new ImprovedNoise();

function getNoiseHeight(x, z) {
	const scale = 0.1;
	return HEIGHT_SCALE * noise.noise(x * scale, 0, z * scale);
}

function createChunk(x, z) {
	const chunkGroup = new THREE.Group();
	
	// Create grid lines
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
		const line1 = new THREE.Line(lineGeometry1, lineMaterial);
		const line2 = new THREE.Line(lineGeometry2, lineMaterial);

		chunkGroup.add(line1);
		chunkGroup.add(line2);
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

	// Remove out-of-range chunks
	for (const [key, chunk] of chunks) {
		const [chunkX, chunkZ] = key.split(',').map(Number);
		if (Math.abs(chunkX - playerChunkX) > RENDER_DISTANCE || 
			Math.abs(chunkZ - playerChunkZ) > RENDER_DISTANCE) {
			scene.remove(chunk);
			chunks.delete(key);
		}
	}
}


// Character movement
const moveSpeed = 2.5;
const TURN_SPEED = 3 * Math.PI; // 2π radians per second (adjust as needed)
const keyState = {};
let targetRotation = 0; // New: the angle the character should face

document.addEventListener('keydown', (event) => {
    keyState[event.code] = true;
});

document.addEventListener('keyup', (event) => {
    keyState[event.code] = false;
});

function moveCharacter(deltaTime) {
    if (!character || !mixer) return;

    const moveVector = new THREE.Vector3();
    let isMoving = false;

    if (keyState['ArrowUp'] || keyState['KeyW']) {
        moveVector.z -= 1;
        moveVector.x -= 1;
        isMoving = true;
    }
    if (keyState['ArrowDown'] || keyState['KeyS']) {
        moveVector.z += 1;
        moveVector.x += 1;
        isMoving = true;
    }
    if (keyState['ArrowLeft'] || keyState['KeyA']) {
        moveVector.z += 1;
        moveVector.x -= 1;
        isMoving = true;
    }
    if (keyState['ArrowRight'] || keyState['KeyD']) {
        moveVector.z -= 1;
        moveVector.x += 1;
        isMoving = true;
    }

    if (isMoving) {
        moveVector.normalize();
        
        // Calculate target rotation
        targetRotation = Math.atan2(-moveVector.x, -moveVector.z);
        
        // Smoothly rotate the character
        let currentRotation = character.rotation.y;
        let rotationDiff = targetRotation - currentRotation;
        rotationDiff = Math.atan2(Math.sin(rotationDiff), Math.cos(rotationDiff));

        const step = TURN_SPEED * deltaTime;
        if (Math.abs(rotationDiff) < step) {
            character.rotation.y = targetRotation;
        } else {
            character.rotation.y += Math.sign(rotationDiff) * step;
        }
        
        // Move the character
        const movement = moveVector.multiplyScalar(moveSpeed * deltaTime);
        character.position.add(movement);
        
        // Adjust character's height based on terrain
        const terrainHeight = getNoiseHeight(character.position.x, character.position.z);
        character.position.y = terrainHeight + 1; // Adjust as needed

        // Blend to run animation
        // fadeToAction('Walk', 0.2);
        if (animations['Walk']) {
            animations['Walk'].play();
            if (animations['Idle']) animations['Idle'].stop();
        }
    } else {
        // Blend to idle animation
        // fadeToAction('Idle', 0.2);
        if (animations['Idle']) {
            animations['Idle'].play();
            if (animations['Walk']) animations['Walk'].stop();
        }
    }

    // Update animation mixer
    if (mixer) mixer.update(deltaTime);
}

// New function to handle animation transitions
function fadeToAction(name, duration) {
    const newAction = animations[name];
    if (currentAction && currentAction !== newAction) {
        currentAction.fadeOut(duration);
    }
    if (newAction) {
        newAction.reset()
            .setEffectiveTimeScale(1)
            .setEffectiveWeight(1)
            .fadeIn(duration)
            .play();
        currentAction = newAction;
    }
}

// Camera following logic
const cameraOffset = new THREE.Vector3(5, 5, 5);
function updateCamera() {
    if (!character) return; // Ensure character is loaded before updating camera
    camera.position.copy(character.position).add(cameraOffset);
    camera.lookAt(character.position);
}

// Animation loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    moveCharacter(deltaTime);
    updateCamera();
    updateChunks();
    renderer.render(scene, camera);
}

// Initialize the application
async function init() {
    try {
        await loadCharacter();
        console.log("Character loaded successfully");
        animate(); // Start the animation loop after character is loaded
    } catch (error) {
        console.error("Failed to load character:", error);
    }
}

init(); // Call the init function to start the application

// Handle window resizing
window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}