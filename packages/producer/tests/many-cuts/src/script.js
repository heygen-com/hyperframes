const masterTL = gsap.timeline({ paused: true });

const variants = ['#v1', '#v2', '#v3', '#v4', '#v5', '#v6', '#v7', '#v8', '#v9', '#v10', '#v11', '#v12', '#v13'];
const cutDuration = 0.2;

variants.forEach((selector, index) => {
    // Show current variant
    masterTL.set(selector, {
        opacity: 1
    }, index * cutDuration);

    // Hide previous variant
    if (index > 0) {
        masterTL.set(variants[index - 1], {
            opacity: 0
        }, index * cutDuration);
    }
});

const finalStartTime = variants.length * cutDuration; // 2.6s

// Hide last variant
masterTL.set(variants[variants.length - 1], {
    opacity: 0
}, finalStartTime);

// Show final message with epic effect
masterTL.to('#final-message', {
    opacity: 1,
    scale: 1,
    duration: 0.8,
    ease: "elastic.out(1, 0.5)"
}, finalStartTime);

// Explosion Particles
const particlesContainer = document.getElementById('particles-container');
const particleCount = 120; // Increased count
const colors = ['#FFD700', '#FF4500', '#FF69B4', '#00FFFF', '#FFF', '#ADFF2F', '#FF8C00'];

for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particlesContainer.appendChild(particle);

    const angle = (i / particleCount) * Math.PI * 2;
    // Deterministic "randomness" using modulo and index
    const velocity = 400 + 600 * ((i * 7) % 10 / 10); // Increased velocity for bigger explosion
    const x = Math.cos(angle) * velocity;
    const y = Math.sin(angle) * velocity;
    const color = colors[i % colors.length];
    const size = 8 + 12 * ((i * 3) % 5 / 5); // Varied sizes

    masterTL.set(particle, {
        x: 540,
        y: 960,
        width: size,
        height: size,
        xPercent: -50,
        yPercent: -50,
        backgroundColor: color,
        opacity: 1,
        scale: 1
    }, finalStartTime);

    masterTL.to(particle, {
        x: 540 + x,
        y: 960 + y,
        opacity: 0,
        scale: 0,
        rotation: (i % 2 === 0 ? 360 : -360), // Add some rotation
        duration: 2.0, // Longer duration for bigger feel
        ease: "power3.out"
    }, finalStartTime);
}

// Register the timeline
window.__timelines = window.__timelines || {};
window.__timelines["magic-cut-intro"] = masterTL;
