/**
 * Auth Interaction Controller
 * Handles automated login with natural behavior simulation and advanced anti-detection
 */

const browserService = require('../services/browser');
const MouseMovement = require('../services/behavioral/mouse-movement');
const KeyboardDynamics = require('../services/behavioral/keyboard-dynamics');
const StealthService = require('../services/stealth');
const FingerprintManager = require('../config/fingerprints');
const WAFBypass = require('../services/evasion/waf-bypass');
const { AntiBotService } = require('../services/antibot');
const { logger } = require('../utils/logger');
const { HeadlessXError, ERROR_CATEGORIES } = require('../utils/errors');

class AuthInteractionController {
    constructor() {
        this.mouseMovement = new MouseMovement();
        this.keyboardDynamics = new KeyboardDynamics();
        this.wafBypass = new WAFBypass();
        this.antiBotService = new AntiBotService();
        this.fingerprintManager = new FingerprintManager();

        // Bind methods
        this.loginWithNaturalInteraction = this.loginWithNaturalInteraction.bind(this);
    }

    /**
     * Perform natural login interaction
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    async loginWithNaturalInteraction(req, res) {
        const requestId = req.requestId || 'req-' + Date.now();

        // Support URL from body (priority) or query parameters
        const url = req.body.url || req.query.url;
        const { username, password } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: url'
            });
        }

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Missing required body parameters: username and/or password'
            });
        }

        // Extract v1.3.0 options from request body
        const options = {
            ...req.body,
            // Anti-detection defaults
            deviceProfile: req.body.deviceProfile || 'mid-range-desktop',
            geoProfile: req.body.geoProfile || 'us-east',
            behaviorProfile: req.body.behaviorProfile || 'natural',
            enableCanvasSpoofing: req.body.enableCanvasSpoofing !== false,
            enableWebGLSpoofing: req.body.enableWebGLSpoofing !== false,
            enableAudioSpoofing: req.body.enableAudioSpoofing !== false,
            enableWebRTCBlocking: req.body.enableWebRTCBlocking !== false,
            enableAdvancedStealth: req.body.enableAdvancedStealth !== false,

            // Behavioral defaults
            simulateMouseMovement: req.body.simulateMouseMovement !== false,
            simulateTyping: req.body.simulateTyping !== false,
            randomizeTimings: req.body.randomizeTimings !== false,
            humanDelays: req.body.humanDelays !== false,

            // Timeout defaults
            timeout: req.body.timeout || 60000,
            extraWaitTime: req.body.extraWaitTime || 5000
        };

        let context = null;
        let page = null;
        let browser = null;

        try {
            logger.info(requestId, `Starting natural login flow for ${url}`);

            // 1. Get Browser Instance
            browser = await browserService.getBrowser();

            // 2. Generate Advanced Fingerprint
            const DEVICE_TO_FINGERPRINT = {
                'high-end-desktop': 'windows-chrome-high-end',
                'mid-range-desktop': 'windows-chrome-mid-range',
                'business-laptop': 'business-laptop',
                'gaming-laptop': 'gaming-laptop',
                'desktop-caracas': 'desktop-caracas'
            };

            let fingerprint = null;
            if (options.enableAdvancedStealth) {
                const profileId = DEVICE_TO_FINGERPRINT[options.deviceProfile] || 'windows-chrome-mid-range';
                fingerprint = this.fingerprintManager.generateProfile(profileId, {
                    behaviorProfile: options.behaviorProfile
                });

                if (options.userAgent) {
                    fingerprint.userAgent = options.userAgent;
                    if (fingerprint.headers) {
                        fingerprint.headers['User-Agent'] = options.userAgent;
                    }
                }

                logger.debug(requestId, 'Generated advanced fingerprint', { profileId: fingerprint.profileId });
            }

            // 3. Build Context Options
            const contextOptions = this.fingerprintManager.buildContextOptions(fingerprint, {
                userAgent: options.userAgent,
                extraHTTPHeaders: {
                    ...(fingerprint?.headers || {}),
                    ...(options.headers || {})
                },
                viewport: fingerprint?.viewport || options.viewport || { width: 1920, height: 1080 },
                deviceProfile: options.deviceProfile,
                geoProfile: options.geoProfile,
                fingerprint: fingerprint
            });

            // Add cookies if provided
            if (options.cookies && options.cookies.length > 0) {
                contextOptions.cookies = options.cookies;
            }

            // 4. Create Isolated Context
            context = await browserService.createIsolatedContext(browser, contextOptions);

            // 5. Apply Fingerprint Scripts
            if (fingerprint && options.enableAdvancedStealth) {
                await this.fingerprintManager.applyFingerprint(context, fingerprint);
            }

            // Setup Google cookies if needed
            await StealthService.setupGoogleCookies(context, url);

            page = await context.newPage();

            // Setup request interception
            await StealthService.setupRequestInterception(page);

            // Add stealth script
            await context.addInitScript(StealthService.getStealthScript());

            // 6. Navigate with WAF Detection
            logger.debug(requestId, 'Navigating to target URL...');
            const response = await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: options.timeout
            });

            // 7. Check for WAF
            const wafDetection = await this.wafBypass.detectWAF(response);
            if (wafDetection.length > 0) {
                logger.warn(requestId, 'WAF Detected', { wafs: wafDetection.map(w => w.name) });
                const bypassed = await this.wafBypass.applyWAFBypass(page, wafDetection);
                if (bypassed) {
                    logger.info(requestId, 'WAF Bypass techniques applied');
                    await page.reload({ waitUntil: 'networkidle' });
                }
            }

            // Helper for natural mouse movement
            let mouseState = { x: 100, y: 100 };

            const performNaturalMove = async (targetSelector) => {
                if (!options.simulateMouseMovement) {
                    return page.$(targetSelector);
                }

                const element = await page.$(targetSelector);
                if (!element) throw new Error(`Element not found: ${targetSelector}`);

                const box = await element.boundingBox();
                if (!box) throw new Error(`Element invisible: ${targetSelector}`);

                // Randomize target within element
                const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * (box.width * 0.2);
                const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * (box.height * 0.2);

                const path = this.mouseMovement.generateBezierPath(
                    { x: mouseState.x, y: mouseState.y },
                    { x: targetX, y: targetY },
                    options.behaviorProfile || 'natural'
                );

                // Execute movement
                for (const point of path) {
                    await page.mouse.move(point.x, point.y);
                }

                mouseState = { x: targetX, y: targetY };
                return element;
            };

            // Helper for natural typing
            const performNaturalTyping = async (text) => {
                if (!options.simulateTyping) {
                    await page.keyboard.type(text);
                    return;
                }

                const keystrokes = this.keyboardDynamics.calculateTypingTiming(
                    text,
                    fingerprint?.profileId || 'standard',
                    'normal'
                );

                for (let i = 0; i < keystrokes.length; i++) {
                    const k = keystrokes[i];
                    const delay = i > 0 ? k.keyDown - keystrokes[i - 1].keyUp : 0;

                    if (delay > 0) await page.waitForTimeout(delay);

                    await page.keyboard.press(k.char, { delay: k.dwellTime });
                }
            };

            // 8. Interact with Username
            logger.debug(requestId, 'Typing username');
            const usernameInput = await performNaturalMove('#username');
            if (usernameInput) {
                await usernameInput.click();
                if (options.humanDelays) await page.waitForTimeout(Math.random() * 500 + 200);
                await performNaturalTyping(username);
            } else {
                throw new Error('Username field (#username) not found');
            }

            if (options.humanDelays) await page.waitForTimeout(Math.random() * 800 + 300);

            // 9. Interact with Password
            logger.debug(requestId, 'Typing password');
            const passwordInput = await performNaturalMove('#password');
            if (passwordInput) {
                await passwordInput.click();
                if (options.humanDelays) await page.waitForTimeout(Math.random() * 500 + 200);
                await performNaturalTyping(password);
            } else {
                throw new Error('Password field (#password) not found');
            }

            if (options.humanDelays) await page.waitForTimeout(Math.random() * 800 + 300);

            // 10. Press Enter to Login
            logger.debug(requestId, 'Pressing Enter to login');

            await Promise.all([
                page.waitForNavigation({ timeout: options.timeout, waitUntil: 'networkidle' }),
                page.keyboard.press('Enter')
            ]);

            logger.debug(requestId, 'Login submitted, navigation complete');

            // Wait for extra time if configured (for dynamic content loading)
            if (options.extraWaitTime) {
                await page.waitForTimeout(options.extraWaitTime);
            }

            // 10.5. reCAPTCHA Verification (if enabled)
            if (options.verifyRecaptcha !== false) {
                logger.debug(requestId, 'Checking for reCAPTCHA...');

                const recaptchaDetected = await page.evaluate(() => {
                    // Check for various reCAPTCHA indicators
                    const recaptchaSelectors = [
                        '.g-recaptcha',
                        '#recaptcha',
                        '[data-recaptcha]',
                        'iframe[src*="recaptcha"]',
                        'iframe[src*="google.com/recaptcha"]',
                        '.recaptcha-checkbox',
                        '#rc-imageselect'
                    ];

                    for (const selector of recaptchaSelectors) {
                        if (document.querySelector(selector)) {
                            return {
                                detected: true,
                                selector: selector,
                                visible: true
                            };
                        }
                    }

                    // Check for reCAPTCHA in iframes
                    const iframes = document.querySelectorAll('iframe');
                    for (const iframe of iframes) {
                        if (iframe.src && (iframe.src.includes('recaptcha') || iframe.src.includes('hcaptcha'))) {
                            return {
                                detected: true,
                                selector: 'iframe',
                                type: iframe.src.includes('hcaptcha') ? 'hCaptcha' : 'reCAPTCHA',
                                visible: true
                            };
                        }
                    }

                    return { detected: false };
                });

                if (recaptchaDetected.detected) {
                    logger.warn(requestId, `reCAPTCHA detected (${recaptchaDetected.type || 'reCAPTCHA'})`, {
                        selector: recaptchaDetected.selector
                    });

                    // Wait for reCAPTCHA to be solved
                    const recaptchaTimeout = options.recaptchaTimeout || 120000; // 2 minutes default
                    const startTime = Date.now();

                    logger.info(requestId, `Waiting for reCAPTCHA to be solved (timeout: ${recaptchaTimeout}ms)...`);

                    try {
                        // Wait for reCAPTCHA to disappear or for navigation
                        await page.waitForFunction(
                            () => {
                                // Check if reCAPTCHA elements are gone
                                const selectors = [
                                    '.g-recaptcha',
                                    '#recaptcha',
                                    '[data-recaptcha]',
                                    'iframe[src*="recaptcha"]',
                                    '#rc-imageselect'
                                ];

                                const hasRecaptcha = selectors.some(sel => document.querySelector(sel));

                                // Also check if we've navigated away
                                const navigated = !window.location.href.includes('recaptcha');

                                return !hasRecaptcha || navigated;
                            },
                            { timeout: recaptchaTimeout, polling: 1000 }
                        );

                        const solveTime = Math.round((Date.now() - startTime) / 1000);
                        logger.info(requestId, `reCAPTCHA solved successfully (${solveTime}s)`);

                        // Wait a bit more for any post-captcha redirects
                        await page.waitForTimeout(2000);

                    } catch (timeoutError) {
                        logger.error(requestId, 'reCAPTCHA solving timeout - continuing anyway');
                        // Don't throw error, continue with the flow
                    }
                } else {
                    logger.debug(requestId, 'No reCAPTCHA detected');
                }
            }


            // 11. Post-Login Analysis
            const botReport = await this.antiBotService.generateReport(page);
            if (botReport.overallThreatLevel === 'critical' || botReport.overallThreatLevel === 'high') {
                logger.warn(requestId, 'High bot detection threat detected after login', {
                    threat: botReport.overallThreatLevel,
                    detections: botReport.pageAnalysis.detected
                });
            }

            // Check for reCAPTCHA in final analysis
            const finalRecaptchaCheck = await page.evaluate(() => {
                const selectors = ['.g-recaptcha', '#recaptcha', 'iframe[src*="recaptcha"]'];
                return selectors.some(sel => document.querySelector(sel));
            });

            // 12. Collect Results
            const content = await page.content();
            const cookies = await context.cookies();
            const title = await page.title();

            res.json({
                success: true,
                data: {
                    html: content,
                    cookies: cookies,
                    url: page.url(),
                    title: title,
                    securityAnalysis: {
                        wafDetected: wafDetection.length > 0,
                        botThreatLevel: botReport.overallThreatLevel,
                        recaptchaDetected: botReport.pageAnalysis.detected.some(d => d.system === 'recaptcha'),
                        recaptchaPresent: finalRecaptchaCheck
                    },
                    metadata: {
                        deviceProfile: options.deviceProfile,
                        geoProfile: options.geoProfile,
                        fingerprintId: fingerprint?.id,
                        verifyRecaptcha: options.verifyRecaptcha !== false
                    }
                }
            });

        } catch (error) {
            logger.error(requestId, 'Login failed', error);

            // Capture screenshot on failure if possible
            let errorScreenshot = null;
            if (page) {
                try {
                    errorScreenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
                } catch (e) { /* ignore */ }
            }

            res.status(500).json({
                success: false,
                error: error.message,
                url: page ? page.url() : url,
                screenshot: errorScreenshot ? `data:image/png;base64,${errorScreenshot}` : null,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        } finally {
            if (context) {
                await browserService.safeCloseContext(context, requestId);
            }
        }
    }
}

module.exports = new AuthInteractionController();
