const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const TEST_TOKEN = 'test-token-123';
const PORT = 3001; // Use a different port to avoid conflicts

const serverEnv = {
    ...process.env,
    AUTH_TOKEN: TEST_TOKEN,
    PORT: PORT,
    NODE_ENV: 'development'
};

console.log('Starting server...');
const server = spawn('node', ['src/app.js'], {
    env: serverEnv,
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
});

let serverReady = false;

server.stdout.on('data', (data) => {
    const output = data.toString();
    // console.log('[SERVER]', output); // Uncomment for debug
    if (output.includes('Server ready')) {
        console.log('Server is ready!');
        serverReady = true;
        runTest();
    }
});

server.stderr.on('data', (data) => {
    console.error('[SERVER ERR]', data.toString());
});

function runTest() {
    const data = JSON.stringify({
        username: 'testuser',
        password: 'testpassword'
    });

    // We use a dummy URL that won't actually work but will trigger the browser logic
    // We expect it to fail on selector finding or navigation, but return a 500 or 400.
    // Or if we want to test success, we need a real page.
    // For now, let's test that it REACHES the browser logic.
    // If it fails with "Element not found", that means it tried.
    const targetUrl = 'http://example.com';
    const apiUrl = `http://localhost:${PORT}/api/login?url=` + encodeURIComponent(targetUrl);

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            'x-token': TEST_TOKEN
        }
    };

    console.log('Sending request to:', apiUrl);

    const req = http.request(apiUrl, options, (res) => {
        console.log(`STATUS: ${res.statusCode}`);

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            body += chunk;
        });
        res.on('end', () => {
            console.log('BODY:', body);
            cleanup();
        });
    });

    req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
        cleanup();
    });

    req.write(data);
    req.end();
}

function cleanup() {
    console.log('Stopping server...');
    server.kill();
    process.exit(0);
}

// Timeout safety
setTimeout(() => {
    if (!serverReady) {
        console.error('Timeout waiting for server start');
        cleanup();
    }
}, 30000);
