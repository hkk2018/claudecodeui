/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Session tracking: Map of session IDs to active query instances
const activeSessions = new Map();

// Permission request tracking: Map of request IDs to pending resolvers
// Each entry: { resolve, reject, toolName, input, suggestions }
const pendingPermissionRequests = new Map();

/**
 * Generates a unique ID for permission requests
 * @returns {string} Unique permission request ID
 */
function generatePermissionRequestId() {
  return `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Registers a pending permission request
 * @param {string} requestId - Unique request ID
 * @param {Object} resolver - Promise resolver { resolve, reject }
 * @param {Object} metadata - Request metadata { toolName, input, suggestions, toolUseID }
 */
function registerPermissionRequest(requestId, resolver, metadata) {
  pendingPermissionRequests.set(requestId, {
    ...resolver,
    ...metadata,
    timestamp: Date.now()
  });
}

/**
 * Resolves a pending permission request with user's response
 * @param {string} requestId - The permission request ID
 * @param {Object} response - User's response { behavior, message, updatedPermissions }
 * @returns {boolean} True if request was found and resolved
 */
function resolvePermissionRequest(requestId, response) {
  const pending = pendingPermissionRequests.get(requestId);
  if (!pending) {
    console.log(`⚠️ Permission request ${requestId} not found`);
    return false;
  }

  pendingPermissionRequests.delete(requestId);

  // Build the PermissionResult based on user's response
  let permissionResult;

  if (response.behavior === 'allow') {
    permissionResult = {
      behavior: 'allow',
      updatedInput: pending.input,
      updatedPermissions: response.updatedPermissions || []
    };
  } else {
    permissionResult = {
      behavior: 'deny',
      message: response.message || 'User denied the request',
      interrupt: response.interrupt !== false // Default to true for deny
    };
  }

  console.log(`✅ Permission request ${requestId} resolved:`, permissionResult.behavior);
  pending.resolve(permissionResult);
  return true;
}

/**
 * Cleans up timed-out permission requests
 * @param {number} timeoutMs - Timeout in milliseconds (default 5 minutes)
 */
function cleanupTimedOutPermissions(timeoutMs = 300000) {
  const now = Date.now();
  for (const [requestId, request] of pendingPermissionRequests.entries()) {
    if (now - request.timestamp > timeoutMs) {
      console.log(`⏰ Permission request ${requestId} timed out`);
      request.resolve({
        behavior: 'deny',
        message: 'Permission request timed out',
        interrupt: false
      });
      pendingPermissionRequests.delete(requestId);
    }
  }
}

/**
 * Maps CLI options to SDK-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} SDK-compatible options
 */
function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode, images } = options;

  const sdkOptions = {};

  // Map working directory
  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  // Map permission mode
  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // Handle tool permissions
  if (settings.skipPermissions && permissionMode !== 'plan') {
    // When skipping permissions, use bypassPermissions mode
    sdkOptions.permissionMode = 'bypassPermissions';
  } else {
    // Map allowed tools
    let allowedTools = [...(settings.allowedTools || [])];

    // Add plan mode default tools
    if (permissionMode === 'plan') {
      const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite'];
      for (const tool of planModeTools) {
        if (!allowedTools.includes(tool)) {
          allowedTools.push(tool);
        }
      }
    }

    if (allowedTools.length > 0) {
      sdkOptions.allowedTools = allowedTools;
    }

    // Map disallowed tools
    if (settings.disallowedTools && settings.disallowedTools.length > 0) {
      sdkOptions.disallowedTools = settings.disallowedTools;
    }
  }

  // Map model (default to sonnet)
  // Map model (default to sonnet)
  sdkOptions.model = options.model || 'sonnet';

  // Map system prompt configuration
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'  // Required to use CLAUDE.md
  };

  // Map setting sources for CLAUDE.md loading
  // This loads CLAUDE.md from project, user (~/.config/claude/CLAUDE.md), and local directories
  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Map resume session
  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  return sdkOptions;
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, queryInstance, tempImagePaths = [], tempDir = null) {
  activeSessions.set(sessionId, {
    instance: queryInstance,
    startTime: Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir
  });
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  activeSessions.delete(sessionId);
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // SDK messages are already in a format compatible with the frontend
  // The CLI sends them wrapped in {type: 'claude-response', data: message}
  // We'll do the same here to maintain compatibility
  return sdkMessage;
}

/**
 * Extracts token usage from SDK result messages
 * @param {Object} resultMessage - SDK result message
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudget(resultMessage) {
  if (resultMessage.type !== 'result' || !resultMessage.modelUsage) {
    return null;
  }

  // Get the first model's usage data
  const modelKey = Object.keys(resultMessage.modelUsage)[0];
  const modelData = resultMessage.modelUsage[modelKey];

  if (!modelData) {
    return null;
  }

  // Use cumulative tokens if available (tracks total for the session)
  // Otherwise fall back to per-request tokens
  const inputTokens = modelData.cumulativeInputTokens || modelData.inputTokens || 0;
  const outputTokens = modelData.cumulativeOutputTokens || modelData.outputTokens || 0;
  const cacheReadTokens = modelData.cumulativeCacheReadInputTokens || modelData.cacheReadInputTokens || 0;
  const cacheCreationTokens = modelData.cumulativeCacheCreationInputTokens || modelData.cacheCreationInputTokens || 0;

  // Total used = input + output + cache tokens
  const totalUsed = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

  // Use configured context window budget from environment (default 160000)
  // This is the user's budget limit, not the model's context window
  const contextWindow = parseInt(process.env.CONTEXT_WINDOW) || 160000;

  console.log(`📊 Token calculation: input=${inputTokens}, output=${outputTokens}, cache=${cacheReadTokens + cacheCreationTokens}, total=${totalUsed}/${contextWindow}`);

  return {
    used: totalUsed,
    total: contextWindow
  };
}

/**
 * Handles image processing for SDK queries
 * Saves base64 images to temporary files and returns modified prompt with file paths
 * @param {string} command - Original user prompt
 * @param {Array} images - Array of image objects with base64 data
 * @param {string} cwd - Working directory for temp file creation
 * @returns {Promise<Object>} {modifiedCommand, tempImagePaths, tempDir}
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Save each image to a temp file
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const extension = mimeType.split('/')[1] || 'png';
      const filename = `image_${index}.${extension}`;
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    // Include the full image paths in the prompt
    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Images provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    console.log(`📸 Processed ${tempImagePaths.length} images to temp directory: ${tempDir}`);
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for SDK:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

/**
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    console.log(`🧹 Cleaned up ${tempImagePaths.length} temp image files`);
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      console.log('📡 No ~/.claude.json found, proceeding without MCP servers');
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('❌ Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      console.log(`📡 Loaded ${Object.keys(mcpServers).length} global MCP servers`);
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        console.log(`📡 Loaded ${Object.keys(projectConfig.mcpServers).length} project-specific MCP servers`);
      }
    }

    // Return null if no servers found
    if (Object.keys(mcpServers).length === 0) {
      console.log('📡 No MCP servers configured');
      return null;
    }

    console.log(`✅ Total MCP servers loaded: ${Object.keys(mcpServers).length}`);
    return mcpServers;
  } catch (error) {
    console.error('❌ Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Creates a canUseTool callback that sends permission requests to frontend via WebSocket
 * @param {Object} ws - WebSocket connection
 * @returns {Function} canUseTool callback function
 */
function createCanUseTool(ws) {
  return async (toolName, input, options) => {
    const { signal, suggestions, toolUseID } = options;

    // Generate unique request ID
    const requestId = generatePermissionRequestId();

    console.log(`🔐 Permission request for tool: ${toolName}`);
    console.log(`   Request ID: ${requestId}`);
    console.log(`   Tool Use ID: ${toolUseID}`);
    console.log(`   Suggestions:`, suggestions ? suggestions.length : 0);
    if (suggestions && suggestions.length > 0) {
      console.log(`   Suggestions detail:`, JSON.stringify(suggestions, null, 2));
    }

    // Create a promise that will be resolved when user responds
    const responsePromise = new Promise((resolve, reject) => {
      // Register the pending request
      registerPermissionRequest(requestId, { resolve, reject }, {
        toolName,
        input,
        suggestions,
        toolUseID
      });

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          pendingPermissionRequests.delete(requestId);
          reject(new Error('Permission request aborted'));
        }, { once: true });
      }
    });

    // Send permission request to frontend
    ws.send(JSON.stringify({
      type: 'permission-request',
      requestId,
      toolName,
      toolInput: input,
      toolUseID,
      suggestions: suggestions || [],
      timestamp: Date.now()
    }));

    console.log(`📤 Permission request sent to frontend: ${requestId}`);

    // Wait for user response
    return responsePromise;
  };
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId } = options;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;

  try {
    // Map CLI options to SDK format
    const sdkOptions = mapCliOptionsToSDK(options);

    // Load MCP configuration
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }

    // Handle images - save to temp files and modify prompt
    const imageResult = await handleImages(command, options.images, options.cwd);
    const finalCommand = imageResult.modifiedCommand;
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    // Create canUseTool callback for permission handling
    const canUseTool = createCanUseTool(ws);

    // Create SDK query instance with canUseTool callback
    const queryInstance = query({
      prompt: finalCommand,
      options: {
        ...sdkOptions,
        canUseTool
      }
    });

    // Track the query instance for abort capability
    if (capturedSessionId) {
      addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir);
    }

    // Process streaming messages
    console.log('🔄 Starting async generator loop for session:', capturedSessionId || 'NEW');
    for await (const message of queryInstance) {
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {

        capturedSessionId = message.session_id;
        addSession(capturedSessionId, queryInstance, tempImagePaths, tempDir);

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          ws.send(JSON.stringify({
            type: 'session-created',
            sessionId: capturedSessionId
          }));
        } else {
          console.log('⚠️ Not sending session-created. sessionId:', sessionId, 'sessionCreatedSent:', sessionCreatedSent);
        }
      } else {
        console.log('⚠️ No session_id in message or already captured. message.session_id:', message.session_id, 'capturedSessionId:', capturedSessionId);
      }

      // Transform and send message to WebSocket
      const transformedMessage = transformMessage(message);
      ws.send(JSON.stringify({
        type: 'claude-response',
        data: transformedMessage
      }));

      // Extract and send token budget updates from result messages
      if (message.type === 'result') {
        const tokenBudget = extractTokenBudget(message);
        if (tokenBudget) {
          console.log('📊 Token budget from modelUsage:', tokenBudget);
          ws.send(JSON.stringify({
            type: 'token-budget',
            data: tokenBudget
          }));
        }
      }
    }

    // Clean up session on completion
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Send completion event
    console.log('✅ Streaming complete, sending claude-complete event');
    ws.send(JSON.stringify({
      type: 'claude-complete',
      sessionId: capturedSessionId,
      exitCode: 0,
      isNewSession: !sessionId && !!command
    }));
    console.log('📤 claude-complete event sent');

  } catch (error) {
    console.error('SDK query error:', error);

    // Clean up session on error
    if (capturedSessionId) {
      removeSession(capturedSessionId);
    }

    // Clean up temporary image files on error
    await cleanupTempFiles(tempImagePaths, tempDir);

    // Send error to WebSocket
    ws.send(JSON.stringify({
      type: 'claude-error',
      error: error.message
    }));

    throw error;
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  try {
    console.log(`🛑 Aborting SDK session: ${sessionId}`);

    // Call interrupt() on the query instance
    await session.instance.interrupt();

    // Update session status
    session.status = 'aborted';

    // Clean up temporary image files
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);

    // Clean up session
    removeSession(sessionId);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

/**
 * Gets session info including active status and start time
 * @param {string} sessionId - Session identifier
 * @returns {Object|null} Session info or null if not found
 */
function getSessionInfo(sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }
  return {
    isActive: session.status === 'active',
    startTime: session.startTime,
    status: session.status
  };
}

/**
 * Gets detailed status of all active sessions
 * Useful for debugging stuck sessions
 * @returns {Array<Object>} Array of session status objects
 */
function getAllSessionsStatus() {
  const now = Date.now();
  const sessions = [];

  for (const [sessionId, session] of activeSessions.entries()) {
    const runningTime = now - session.startTime;
    sessions.push({
      sessionId,
      status: session.status,
      startTime: session.startTime,
      runningTimeMs: runningTime,
      runningTimeFormatted: formatDuration(runningTime),
      hasTempFiles: session.tempImagePaths?.length > 0
    });
  }

  return sessions;
}

/**
 * Gets all pending permission requests
 * @returns {Array<Object>} Array of pending permission request objects
 */
function getAllPendingPermissions() {
  const now = Date.now();
  const permissions = [];

  for (const [requestId, request] of pendingPermissionRequests.entries()) {
    const waitingTime = now - request.timestamp;
    permissions.push({
      requestId,
      toolName: request.toolName,
      toolUseID: request.toolUseID,
      timestamp: request.timestamp,
      waitingTimeMs: waitingTime,
      waitingTimeFormatted: formatDuration(waitingTime),
      input: request.input,
      suggestions: request.suggestions
    });
  }

  return permissions;
}

/**
 * Formats duration in milliseconds to human-readable format
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Gets comprehensive debug information about sessions and permissions
 * @returns {Object} Debug info object
 */
function getDebugInfo() {
  return {
    activeSessions: getAllSessionsStatus(),
    pendingPermissions: getAllPendingPermissions(),
    timestamp: Date.now()
  };
}

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  getActiveClaudeSDKSessions,
  getSessionInfo,
  resolvePermissionRequest,
  cleanupTimedOutPermissions,
  getAllSessionsStatus,
  getAllPendingPermissions,
  getDebugInfo
};
