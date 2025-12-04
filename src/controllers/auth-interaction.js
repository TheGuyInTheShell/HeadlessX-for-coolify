/**
 * Auth Interaction Controller
 * Handles automated login with natural behavior simulation and advanced anti-detection
 */

const browserService = require('../services/browser');
const MouseMovement = require('../services/behavioral/mouse-movement');
const KeyboardDynamics = require('../services/behavioral/keyboard-dynamics');
const StealthService = require('../services/stealth');
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
        const { url } = req.query;
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

        let context = null;
        let page = null;

        try {
            logger.info(requestId, `Starting natural login flow for ${url}`);

            // 1. Generate Advanced Fingerprint
            const fingerprint = StealthService.generateAdvancedFingerprint();
            logger.debug(requestId, 'Generated advanced fingerprint', { profileId: fingerprint.profileId });

            // 2. Initialize Browser Context with Stealth Options
            context = await browserService.createIsolatedContext(null, {
                fingerprint: fingerprint,
                behavioral: 'natural',
                deviceProfile: fingerprint.profileId
            });

            // 3. Apply Fingerprint Scripts
            await StealthService.applyFingerprintToContext(context, fingerprint);

            page = await context.newPage();

            // 4. Navigate with WAF Detection
            logger.debug(requestId, 'Navigating to target URL...');
            const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

            // 5. Check for WAF
            const wafDetection = await this.wafBypass.detectWAF(response);
            if (wafDetection.length > 0) {
                logger.warn(requestId, 'WAF Detected', { wafs: wafDetection.map(w => w.name) });
                const bypassed = await this.wafBypass.applyWAFBypass(page, wafDetection);
                if (bypassed) {
                    logger.info(requestId, 'WAF Bypass techniques applied');
                    // Reload to apply bypass
                    await page.reload({ waitUntil: 'networkidle' });
                }
            }

            // Helper for natural mouse movement
            // We maintain state here for the session
            let mouseState = { x: 100, y: 100 };

            const performNaturalMove = async (targetSelector) => {
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
                    'natural'
                );

                // Execute movement
                for (const point of path) {
                    await page.mouse.move(point.x, point.y);
                    // Optional: add tiny sleep for realism if needed, but path timestamps suggest timing
                    // For now, we rely on Playwright's speed or just the path resolution
                }

                mouseState = { x: targetX, y: targetY };
                return element;
            };

            // Helper for natural typing
            const performNaturalTyping = async (text) => {
                const keystrokes = this.keyboardDynamics.calculateTypingTiming(text, fingerprint.profileId, 'normal');

                for (let i = 0; i < keystrokes.length; i++) {
                    const k = keystrokes[i];
                    const delay = i > 0 ? k.keyDown - keystrokes[i - 1].keyUp : 0;

                    if (delay > 0) await page.waitForTimeout(delay);

                    await page.keyboard.press(k.char, { delay: k.dwellTime });
                }
            };

            // 6. Interact with Username
            logger.debug(requestId, 'Typing username');
            const usernameInput = await performNaturalMove('#username');
            await usernameInput.click();
            await performNaturalTyping(username);

            // 7. Interact with Password
            logger.debug(requestId, 'Typing password');
            const passwordInput = await performNaturalMove('#password');
            await passwordInput.click();
            await performNaturalTyping(password);

            // 8. Click Submit Button
            logger.debug(requestId, 'Clicking submit');
            const submitSelector = 'button[data-litms-control-urn="login-submit"]';
            const submitBtn = await performNaturalMove(submitSelector);

            await Promise.all([
                page.waitForNavigation({ timeout: 60000, waitUntil: 'networkidle' }),
                submitBtn.click()
            ]);

            logger.debug(requestId, 'Login submitted, navigation complete');

            // 9. Post-Login Analysis
            const botReport = await this.antiBotService.generateReport(page);
            if (botReport.overallThreatLevel === 'critical' || botReport.overallThreatLevel === 'high') {
                logger.warn(requestId, 'High bot detection threat detected after login', {
                    threat: botReport.overallThreatLevel,
                    detections: botReport.pageAnalysis.detected
                });
            }

            // 10. Collect Results
            const content = await page.content();
            const cookies = await context.cookies();

            res.json({
                success: true,
                data: {
                    html: content,
                    cookies: cookies,
                    url: page.url(),
                    securityAnalysis: {
                        wafDetected: wafDetection.length > 0,
                        botThreatLevel: botReport.overallThreatLevel
                    }
                }
            });

        } catch (error) {
            logger.error(requestId, 'Login failed', error);
            res.status(500).json({
                success: false,
                error: error.message,
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
