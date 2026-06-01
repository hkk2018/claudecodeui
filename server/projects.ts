/**
 * PROJECT DISCOVERY AND MANAGEMENT SYSTEM
 * ========================================
 * 
 * This module manages project discovery for both Claude CLI and Cursor CLI sessions.
 * 
 * ## Architecture Overview
 * 
 * 1. **Claude Projects** (stored in ~/.claude/projects/)
 *    - Each project is a directory named with the project path encoded (/ replaced with -)
 *    - Contains .jsonl files with conversation history including 'cwd' field
 *    - Project metadata stored in ~/.claude/project-config.json
 * 
 * 2. **Cursor Projects** (stored in ~/.cursor/chats/)
 *    - Each project directory is named with MD5 hash of the absolute project path
 *    - Example: /Users/john/myproject -> MD5 -> a1b2c3d4e5f6...
 *    - Contains session directories with SQLite databases (store.db)
 *    - Project path is NOT stored in the database - only in the MD5 hash
 * 
 * ## Project Discovery Strategy
 * 
 * 1. **Claude Projects Discovery**:
 *    - Scan ~/.claude/projects/ directory for Claude project folders
 *    - Extract actual project path from .jsonl files (cwd field)
 *    - Fall back to decoded directory name if no sessions exist
 * 
 * 2. **Cursor Sessions Discovery**:
 *    - For each KNOWN project (from Claude or manually added)
 *    - Compute MD5 hash of the project's absolute path
 *    - Check if ~/.cursor/chats/{md5_hash}/ directory exists
 *    - Read session metadata from SQLite store.db files
 * 
 * 3. **Manual Project Addition**:
 *    - Users can manually add project paths via UI
 *    - Stored in ~/.claude/project-config.json with 'manuallyAdded' flag
 *    - Allows discovering Cursor sessions for projects without Claude sessions
 * 
 * ## Critical Limitations
 * 
 * - **CANNOT discover Cursor-only projects**: From a quick check, there was no mention of
 *   the cwd of each project. if someone has the time, you can try to reverse engineer it.
 * 
 * - **Project relocation breaks history**: If a project directory is moved or renamed,
 *   the MD5 hash changes, making old Cursor sessions inaccessible unless the old
 *   path is known and manually added.
 * 
 * ## Error Handling
 * 
 * - Missing ~/.claude directory is handled gracefully with automatic creation
 * - ENOENT errors are caught and handled without crashing
 * - Empty arrays returned when no projects/sessions exist
 * 
 * ## Caching Strategy
 * 
 * - Project directory extraction is cached to minimize file I/O
 * - Cache is cleared when project configuration changes
 * - Session data is fetched on-demand, not cached
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Import TaskMaster detection functions
async function detectTaskMasterFolder(projectPath) {
    try {
        const taskMasterPath = path.join(projectPath, '.taskmaster');
        
        // Check if .taskmaster directory exists
        try {
            const stats = await fs.stat(taskMasterPath);
            if (!stats.isDirectory()) {
                return {
                    hasTaskmaster: false,
                    reason: '.taskmaster exists but is not a directory'
                };
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    hasTaskmaster: false,
                    reason: '.taskmaster directory not found'
                };
            }
            throw error;
        }

        // Check for key TaskMaster files
        const keyFiles = [
            'tasks/tasks.json',
            'config.json'
        ];
        
        const fileStatus = {};
        let hasEssentialFiles = true;

        for (const file of keyFiles) {
            const filePath = path.join(taskMasterPath, file);
            try {
                await fs.access(filePath);
                fileStatus[file] = true;
            } catch (error) {
                fileStatus[file] = false;
                if (file === 'tasks/tasks.json') {
                    hasEssentialFiles = false;
                }
            }
        }

        // Parse tasks.json if it exists for metadata
        let taskMetadata = null;
        if (fileStatus['tasks/tasks.json']) {
            try {
                const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
                const tasksContent = await fs.readFile(tasksPath, 'utf8');
                const tasksData = JSON.parse(tasksContent);
                
                // Handle both tagged and legacy formats
                let tasks = [];
                if (tasksData.tasks) {
                    // Legacy format
                    tasks = tasksData.tasks;
                } else {
                    // Tagged format - get tasks from all tags
                    Object.values(tasksData).forEach((tagData: any) => {
                        if (tagData.tasks) {
                            tasks = tasks.concat(tagData.tasks);
                        }
                    });
                }

                // Calculate task statistics
                const stats = tasks.reduce((acc, task) => {
                    acc.total++;
                    acc[task.status] = (acc[task.status] || 0) + 1;
                    
                    // Count subtasks
                    if (task.subtasks) {
                        task.subtasks.forEach(subtask => {
                            acc.subtotalTasks++;
                            acc.subtasks = acc.subtasks || {};
                            acc.subtasks[subtask.status] = (acc.subtasks[subtask.status] || 0) + 1;
                        });
                    }
                    
                    return acc;
                }, { 
                    total: 0, 
                    subtotalTasks: 0,
                    pending: 0, 
                    'in-progress': 0, 
                    done: 0, 
                    review: 0,
                    deferred: 0,
                    cancelled: 0,
                    subtasks: {}
                });

                taskMetadata = {
                    taskCount: stats.total,
                    subtaskCount: stats.subtotalTasks,
                    completed: stats.done || 0,
                    pending: stats.pending || 0,
                    inProgress: stats['in-progress'] || 0,
                    review: stats.review || 0,
                    completionPercentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
                    lastModified: (await fs.stat(tasksPath)).mtime.toISOString()
                };
            } catch (parseError) {
                console.warn('Failed to parse tasks.json:', parseError.message);
                taskMetadata = { error: 'Failed to parse tasks.json' };
            }
        }

        return {
            hasTaskmaster: true,
            hasEssentialFiles,
            files: fileStatus,
            metadata: taskMetadata,
            path: taskMasterPath
        };

    } catch (error) {
        console.error('Error detecting TaskMaster folder:', error);
        return {
            hasTaskmaster: false,
            reason: `Error checking directory: ${error.message}`
        };
    }
}

// Cache for extracted project directories
const projectDirectoryCache = new Map();

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
}

// Load project configuration file
async function loadProjectConfig() {
  const configPath = path.join(process.env.HOME, '.claude', 'project-config.json');
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    // Return empty config if file doesn't exist
    return {};
  }
}

// Save project configuration file
async function saveProjectConfig(config) {
  const claudeDir = path.join(process.env.HOME, '.claude');
  const configPath = path.join(claudeDir, 'project-config.json');
  
  // Ensure the .claude directory exists
  try {
    await fs.mkdir(claudeDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
  
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// Generate better display name from path
async function generateDisplayName(projectName, actualProjectDir = null) {
  // Use actual project directory if provided, otherwise decode from project name
  let projectPath = actualProjectDir || projectName.replace(/-/g, '/');
  
  // Try to read package.json from the project path
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);
    
    // Return the name from package.json if it exists
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch (error) {
    // Fall back to path-based naming if package.json doesn't exist or can't be read
  }
  
  // If it starts with /, it's an absolute path
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    // Return only the last folder name
    return parts[parts.length - 1] || projectPath;
  }
  
  return projectPath;
}

// Helper: read first line of a file using head command (O(1) regardless of file size)
// Using first line because session starts at the user's intended project directory,
// while later lines may have cwd pointing to temp directories during Claude's work
async function readFirstLine(filePath) {
  try {
    const { stdout } = await execFileAsync('head', ['-1', filePath], { timeout: 5000 });
    return stdout.trim();
  } catch (error) {
    return null;
  }
}

// Cache for validated path segments to avoid redundant filesystem checks
// Key: partial path (e.g., "/home/ubuntu/Projects"), Value: true (exists)
const pathSegmentCache = new Map();

// Decode project name by incrementally verifying path segments exist on filesystem
// This handles directory names with hyphens (e.g., "my-console", "hpc-frontend-worktree") correctly
//
// Algorithm:
// 1. Build validated prefix path one segment at a time (e.g., /home/ubuntu/Projects/ken)
// 2. For remaining parts, try different dash positions to find valid directory names:
//    - Try first dash: "hpc" ✗
//    - Try second dash: "hpc-frontend" ✗
//    - Try third dash: "hpc-frontend-worktree" ✓ Found!
// 3. Recursively process remaining parts the same way
// 4. Use cache to skip redundant filesystem checks for validated parent paths
//
// Example: "-home-ubuntu-Projects-ken-hpc-frontend-worktree-svc-portal"
//   Step 1: Build prefix
//     /home ✓ → /home/ubuntu ✓ → /home/ubuntu/Projects ✓ → /home/ubuntu/Projects/ken ✓
//     Remaining: ["hpc", "frontend", "worktree", "svc", "portal"]
//
//   Step 2: Try different combinations for next segment
//     /home/ubuntu/Projects/ken/hpc ✗
//     /home/ubuntu/Projects/ken/hpc-frontend ✗
//     /home/ubuntu/Projects/ken/hpc-frontend-worktree ✓ Found!
//     Remaining: ["svc", "portal"]
//
//   Step 3: Recursively process remaining
//     /home/ubuntu/Projects/ken/hpc-frontend-worktree/svc ✗
//     /home/ubuntu/Projects/ken/hpc-frontend-worktree/svc-portal ✓ Found!
//
//   Result: /home/ubuntu/Projects/ken/hpc-frontend-worktree/svc-portal
async function decodeProjectName(projectName) {
  // Remove leading '-' and split by '-'
  const parts = projectName.startsWith('-')
    ? projectName.slice(1).split('-')
    : projectName.split('-');

  return await decodePathRecursive('', parts, 0);
}

// Recursive helper to decode path by trying different dash combinations
// basePath: the validated path so far (e.g., "/home/ubuntu/Projects/ken")
// parts: remaining parts to process (e.g., ["hpc", "frontend", "worktree", "svc", "portal"])
// startIndex: where to start in the parts array
async function decodePathRecursive(basePath, parts, startIndex) {
  // Base case: no more parts to process
  if (startIndex >= parts.length) {
    return basePath;
  }

  // Try combining parts with increasing number of dashes
  // Prefer longer matches (greedy from right to left)
  // e.g., try "hpc-frontend-worktree-svc-portal" first, then "hpc-frontend-worktree-svc", etc.
  let lastValidPath = null;
  let lastValidEndIndex = -1;

  for (let endIndex = startIndex; endIndex < parts.length; endIndex++) {
    const segment = parts.slice(startIndex, endIndex + 1).join('-');
    const candidatePath = basePath + '/' + segment;

    // Check cache first
    if (pathSegmentCache.has(candidatePath)) {
      lastValidPath = candidatePath;
      lastValidEndIndex = endIndex;
      continue;
    }

    // Try accessing the path
    try {
      await fs.access(candidatePath);
      pathSegmentCache.set(candidatePath, true);

      // Found a valid path, but keep trying longer combinations
      lastValidPath = candidatePath;
      lastValidEndIndex = endIndex;
    } catch (error) {
      // Path doesn't exist, continue trying longer combinations
      continue;
    }
  }

  // If we found at least one valid path, use the longest one
  if (lastValidPath) {
    return await decodePathRecursive(lastValidPath, parts, lastValidEndIndex + 1);
  }

  // No valid path found with any combination
  // Return the basePath we have so far, or construct fallback path
  if (basePath) {
    return basePath;
  }

  // Last resort: simple join (should rarely happen)
  return '/' + parts.join('/');
}

// Extract the actual project directory from JSONL sessions (with caching)
// Optimized: only reads the first line of the most recent session file
async function extractProjectDirectory(projectName) {
  // Check cache first
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }

  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  let extractedPath;

  try {
    // Check if the project directory exists
    await fs.access(projectDir);

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      // Fall back to intelligent path decoding if no sessions
      extractedPath = await decodeProjectName(projectName);
    } else {
      // Get file stats to find the most recently modified file
      const fileStats = await Promise.all(
        jsonlFiles.map(async (file) => {
          const filePath = path.join(projectDir, file);
          const stat = await fs.stat(filePath);
          return { file, filePath, mtime: stat.mtimeMs };
        })
      );

      // Sort by modification time (newest first)
      fileStats.sort((a, b) => b.mtime - a.mtime);

      // Try to get cwd from the most recent files (up to 3)
      let cwd = null;
      for (let i = 0; i < Math.min(3, fileStats.length) && !cwd; i++) {
        const firstLine = await readFirstLine(fileStats[i].filePath);
        if (firstLine) {
          try {
            const entry = JSON.parse(firstLine);
            if (entry.cwd) {
              cwd = entry.cwd;
            }
          } catch (parseError) {
            // Skip malformed lines, try next file
          }
        }
      }

      extractedPath = cwd || await decodeProjectName(projectName);
    }

    // Cache the result
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;

  } catch (error) {
    // If the directory doesn't exist, use intelligent path decoding
    if (error.code === 'ENOENT') {
      extractedPath = await decodeProjectName(projectName);
    } else {
      console.error(`Error extracting project directory for ${projectName}:`, error);
      // Fall back to intelligent path decoding for other errors
      extractedPath = await decodeProjectName(projectName);
    }

    // Cache the fallback result too
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;
  }
}

async function getProjects() {
  const startTime = performance.now();
  console.log('[PERF] 🚀 getProjects() started');

  const claudeDir = path.join(process.env.HOME, '.claude', 'projects');
  const config = await loadProjectConfig();
  const projects = [];
  const existingProjects = new Set();

  try {
    // Check if the .claude/projects directory exists
    await fs.access(claudeDir);
    
    // First, get existing Claude projects from the file system
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    
    let totalExtract = 0, totalDisplay = 0, totalSessions = 0, totalCursor = 0, totalTask = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.isDirectory()) {
        existingProjects.add(entry.name);
        const projectPath = path.join(claudeDir, entry.name);

        // Extract actual project directory from JSONL sessions
        let t0 = performance.now();
        const actualProjectDir = await extractProjectDirectory(entry.name);
        totalExtract += performance.now() - t0;

        // Get display name from config or generate one
        t0 = performance.now();
        const customName = config[entry.name]?.displayName;
        const autoDisplayName = await generateDisplayName(entry.name, actualProjectDir);
        totalDisplay += performance.now() - t0;
        const fullPath = actualProjectDir;

        const project: any = {
          name: entry.name,
          path: actualProjectDir,
          displayName: customName || autoDisplayName,
          fullPath: fullPath,
          isCustomName: !!customName,
          sessions: []
        };

        // Try to get sessions for this project (just first 5 for performance)
        try {
          t0 = performance.now();
          const sessionResult = await getSessions(entry.name, 5, 0);
          totalSessions += performance.now() - t0;
          project.sessions = sessionResult.sessions || [];
          project.sessionMeta = {
            hasMore: sessionResult.hasMore,
            total: sessionResult.total
          };
        } catch (e) {
          console.warn(`Could not load sessions for project ${entry.name}:`, e.message);
        }

        // Also fetch Cursor sessions for this project
        try {
          t0 = performance.now();
          project.cursorSessions = await getCursorSessions(actualProjectDir);
          totalCursor += performance.now() - t0;
        } catch (e) {
          console.warn(`Could not load Cursor sessions for project ${entry.name}:`, e.message);
          project.cursorSessions = [];
        }

        // Add TaskMaster detection
        try {
          t0 = performance.now();
          const taskMasterResult = await detectTaskMasterFolder(actualProjectDir);
          totalTask += performance.now() - t0;
          project.taskmaster = {
            hasTaskmaster: taskMasterResult.hasTaskmaster,
            hasEssentialFiles: taskMasterResult.hasEssentialFiles,
            metadata: taskMasterResult.metadata,
            status: taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles ? 'configured' : 'not-configured'
          };
        } catch (e) {
          console.warn(`Could not detect TaskMaster for project ${entry.name}:`, e.message);
          project.taskmaster = {
            hasTaskmaster: false,
            hasEssentialFiles: false,
            metadata: null,
            status: 'error'
          };
        }

        // Only add projects that have at least one session (Claude or Cursor)
        // This filters out empty project folders with only ghost sessions
        const hasAnySessions = (project.sessions && project.sessions.length > 0) ||
                               (project.cursorSessions && project.cursorSessions.length > 0);

        if (hasAnySessions) {
          projects.push(project);
        }

        // Progress log every 5 projects
        if ((i + 1) % 5 === 0) {
          console.log(`[PERF] 🔄 Processed ${i + 1}/${entries.length} projects`);
        }
      }
    }

    console.log(`[PERF] ⏱️ Breakdown: extract=${totalExtract.toFixed(0)}ms, display=${totalDisplay.toFixed(0)}ms, sessions=${totalSessions.toFixed(0)}ms, cursor=${totalCursor.toFixed(0)}ms, task=${totalTask.toFixed(0)}ms`);
  } catch (error) {
    // If the directory doesn't exist (ENOENT), that's okay - just continue with empty projects
    if (error.code !== 'ENOENT') {
      console.error('Error reading projects directory:', error);
    }
  }
  
  // Add manually configured projects that don't exist as folders yet
  for (const [projectName, projectConfig] of Object.entries(config) as [string, any][]) {
    if (!existingProjects.has(projectName) && projectConfig.manuallyAdded) {
      // Use the original path if available, otherwise extract from potential sessions
      let actualProjectDir = projectConfig.originalPath;
      
      if (!actualProjectDir) {
        try {
          actualProjectDir = await extractProjectDirectory(projectName);
        } catch (error) {
          // Fall back to decoded project name
          actualProjectDir = projectName.replace(/-/g, '/');
        }
      }
      
              const project: any = {
          name: projectName,
          path: actualProjectDir,
          displayName: projectConfig.displayName || await generateDisplayName(projectName, actualProjectDir),
          fullPath: actualProjectDir,
          isCustomName: !!projectConfig.displayName,
          isManuallyAdded: true,
          sessions: [],
          cursorSessions: []
        };
      
      // Try to fetch Cursor sessions for manual projects too
      try {
        project.cursorSessions = await getCursorSessions(actualProjectDir);
      } catch (e) {
        console.warn(`Could not load Cursor sessions for manual project ${projectName}:`, e.message);
      }
      
      // Add TaskMaster detection for manual projects
      try {
        const taskMasterResult = await detectTaskMasterFolder(actualProjectDir);
        
        // Determine TaskMaster status
        let taskMasterStatus = 'not-configured';
        if (taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles) {
          taskMasterStatus = 'taskmaster-only'; // We don't check MCP for manual projects in bulk
        }
        
        project.taskmaster = {
          status: taskMasterStatus,
          hasTaskmaster: taskMasterResult.hasTaskmaster,
          hasEssentialFiles: taskMasterResult.hasEssentialFiles,
          metadata: taskMasterResult.metadata
        };
      } catch (error) {
        console.warn(`TaskMaster detection failed for manual project ${projectName}:`, error.message);
        project.taskmaster = {
          status: 'error',
          hasTaskmaster: false,
          hasEssentialFiles: false,
          error: error.message
        };
      }

      // Only add manual projects that have at least one session
      const hasAnySessions = (project.sessions && project.sessions.length > 0) ||
                             (project.cursorSessions && project.cursorSessions.length > 0);

      if (hasAnySessions) {
        projects.push(project);
      }
    }
  }

  console.log(`[PERF] ✅ getProjects() completed in ${(performance.now() - startTime).toFixed(0)}ms with ${projects.length} projects`);
  return projects;
}

// Lightweight version of getProjects - returns only basic info without sessions
// Used for fast initial load, sessions are loaded progressively by frontend
async function getProjectsBasic() {
  const startTime = performance.now();
  console.log('[PERF] 🚀 getProjectsBasic() started');

  const claudeDir = path.join(process.env.HOME, '.claude', 'projects');
  const config = await loadProjectConfig();
  const projects = [];
  const existingProjects = new Set();

  try {
    await fs.access(claudeDir);
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });

    // Get stats for all directories in parallel for sorting by lastModified
    const projectPromises = entries
      .filter(entry => entry.isDirectory())
      .map(async (entry) => {
        existingProjects.add(entry.name);
        const projectPath = path.join(claudeDir, entry.name);

        // These are fast operations (already optimized)
        const [actualProjectDir, stat] = await Promise.all([
          extractProjectDirectory(entry.name),
          fs.stat(projectPath)
        ]);

        const customName = config[entry.name]?.displayName;
        const autoDisplayName = await generateDisplayName(entry.name, actualProjectDir);

        return {
          name: entry.name,
          path: actualProjectDir,
          displayName: customName || autoDisplayName,
          fullPath: actualProjectDir,
          isCustomName: !!customName,
          lastModified: stat.mtimeMs,
          // Sessions will be loaded separately by frontend
          sessions: [],
          cursorSessions: [],
          sessionsLoaded: false
        };
      });

    const resolvedProjects = await Promise.all(projectPromises);
    projects.push(...resolvedProjects);

  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error reading projects directory:', error);
    }
  }

  // Add manually configured projects
  for (const [projectName, projectConfig] of Object.entries(config) as [string, any][]) {
    if (!existingProjects.has(projectName) && projectConfig.manuallyAdded) {
      let actualProjectDir = projectConfig.originalPath;
      if (!actualProjectDir) {
        try {
          actualProjectDir = await extractProjectDirectory(projectName);
        } catch (error) {
          actualProjectDir = projectName.replace(/-/g, '/');
        }
      }

      projects.push({
        name: projectName,
        path: actualProjectDir,
        displayName: projectConfig.displayName || await generateDisplayName(projectName, actualProjectDir),
        fullPath: actualProjectDir,
        isCustomName: !!projectConfig.displayName,
        isManuallyAdded: true,
        lastModified: 0, // Manual projects go to the end
        sessions: [],
        cursorSessions: [],
        sessionsLoaded: false
      });
    }
  }

  // Sort by lastModified (newest first)
  projects.sort((a, b) => b.lastModified - a.lastModified);

  console.log(`[PERF] ✅ getProjectsBasic() completed in ${(performance.now() - startTime).toFixed(0)}ms with ${projects.length} projects`);
  return projects;
}

async function getSessions(projectName, limit = 5, offset = 0) {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    // agent-*.jsonl files contain session start data at this point. This needs to be revisited
    // periodically to make sure only accurate data is there and no new functionality is added there
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
    
    if (jsonlFiles.length === 0) {
      return { sessions: [], hasMore: false, total: 0 };
    }
    
    // Sort files by modification time (newest first)
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime, size: stats.size };
      })
    );
    filesWithStats.sort((a: any, b: any) => (b.mtime as any) - (a.mtime as any));

    const allSessions = new Map();
    const allEntries = [];

    // Collect all sessions and entries from all files. Large files are read
    // head+tail only (readLargeSessionMeta) instead of fully streamed — the old
    // full read of a 575MB session every 30s poll was the dev service's main CPU
    // cost and the memory spike that OOMed it.
    const LARGE_FILE_BYTES = 5 * 1024 * 1024;
    for (const { file, size } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const result = size > LARGE_FILE_BYTES
        ? await readLargeSessionMeta(jsonlFile, file, size)
        : await parseJsonlSessions(jsonlFile);
      
      result.sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });
      
      allEntries.push(...result.entries);
      
      // Early exit optimization for large projects
      if (allSessions.size >= (limit + offset) * 2 && allEntries.length >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }
    
    // Group sessions by first user message ID
    const sessionGroups = new Map(); // firstUserMsgId -> { latestSession, allSessions[] }
    const sessionToFirstUserMsgId = new Map(); // sessionId -> firstUserMsgId

    // Find the first user message for each session
    allEntries.forEach(entry => {
      if (entry.sessionId && entry.type === 'user' && entry.parentUuid === null && entry.uuid) {
        // This is a first user message in a session (parentUuid is null)
        const firstUserMsgId = entry.uuid;

        if (!sessionToFirstUserMsgId.has(entry.sessionId)) {
          sessionToFirstUserMsgId.set(entry.sessionId, firstUserMsgId);

          const session = allSessions.get(entry.sessionId);
          if (session) {
            if (!sessionGroups.has(firstUserMsgId)) {
              sessionGroups.set(firstUserMsgId, {
                latestSession: session,
                allSessions: [session]
              });
            } else {
              const group = sessionGroups.get(firstUserMsgId);
              group.allSessions.push(session);

              // Update latest session if this one is more recent
              if (new Date(session.lastActivity) > new Date(group.latestSession.lastActivity)) {
                group.latestSession = session;
              }
            }
          }
        }
      }
    });

    // Collect all sessions that don't belong to any group (standalone sessions)
    const groupedSessionIds = new Set();
    sessionGroups.forEach(group => {
      group.allSessions.forEach(session => groupedSessionIds.add(session.id));
    });

    const standaloneSessionsArray = Array.from(allSessions.values())
      .filter(session => !groupedSessionIds.has(session.id));

    // Combine grouped sessions (only show latest from each group) + standalone sessions
    const latestFromGroups = Array.from(sessionGroups.values()).map(group => {
      const session = { ...group.latestSession };
      // Add metadata about grouping
      if (group.allSessions.length > 1) {
        session.isGrouped = true;
        session.groupSize = group.allSessions.length;
        session.groupSessions = group.allSessions.map(s => s.id);
      }
      return session;
    });
    const visibleSessions = [...latestFromGroups, ...standaloneSessionsArray]
      .filter(session => !session.summary.startsWith('{ "'))
      .sort((a: any, b: any) => (new Date(b.lastActivity) as any) - (new Date(a.lastActivity) as any));

    const total = visibleSessions.length;
    const paginatedSessions = visibleSessions.slice(offset, offset + limit);
    const hasMore = offset + limit < total;
    
    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading sessions for project ${projectName}:`, error);
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath) {
  const sessions = new Map();
  const entries = [];
  const pendingSummaries = new Map(); // leafUuid -> summary for entries without sessionId

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          // Only the first user message of each session is needed downstream
          // (caller groups sessions by it). Collecting every entry OOMs on
          // large files — per-session metadata below is computed incrementally
          // and does not depend on this array.
          if (entry.type === 'user' && entry.parentUuid === null && entry.uuid) {
            entries.push(entry);
          }

          // Handle summary entries that don't have sessionId yet
          if (entry.type === 'summary' && entry.summary && !entry.sessionId && entry.leafUuid) {
            pendingSummaries.set(entry.leafUuid, entry.summary);
          }

          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: 'New Session',
                messageCount: 0,
                lastActivity: new Date(),
                cwd: entry.cwd || '',
                lastUserMessage: null,
                lastAssistantMessage: null
              });
            }

            const session = sessions.get(entry.sessionId);

            // Apply pending summary if this entry has a parentUuid that matches a pending summary
            if (session.summary === 'New Session' && entry.parentUuid && pendingSummaries.has(entry.parentUuid)) {
              session.summary = pendingSummaries.get(entry.parentUuid);
            }

            // Update summary from summary entries with sessionId
            if (entry.type === 'summary' && entry.summary) {
              session.summary = entry.summary;
            }

            // Track last user and assistant messages (skip system messages)
            if (entry.message?.role === 'user' && entry.message?.content) {
              const content = entry.message.content;

              // Extract text from array format if needed
              let textContent = content;
              if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
                textContent = content[0].text;
              }

              const isSystemMessage = typeof textContent === 'string' && (
                textContent.startsWith('<command-name>') ||
                textContent.startsWith('<command-message>') ||
                textContent.startsWith('<command-args>') ||
                textContent.startsWith('<local-command-stdout>') ||
                textContent.startsWith('<system-reminder>') ||
                textContent.startsWith('Caveat:') ||
                textContent.startsWith('This session is being continued from a previous') ||
                textContent.startsWith('Invalid API key') ||
                textContent.includes('{"subtasks":') || // Filter Task Master prompts
                textContent.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                textContent === 'Warmup' // Explicitly filter out "Warmup"
              );

              if (typeof textContent === 'string' && textContent.length > 0 && !isSystemMessage) {
                session.lastUserMessage = textContent;
              }
            } else if (entry.message?.role === 'assistant' && entry.message?.content) {
              // Skip API error messages using the isApiErrorMessage flag
              if (entry.isApiErrorMessage === true) {
                // Skip this message entirely
              } else {
                // Track last assistant text message
                let assistantText = null;

                if (Array.isArray(entry.message.content)) {
                  for (const part of entry.message.content) {
                    if (part.type === 'text' && part.text) {
                      assistantText = part.text;
                    }
                  }
                } else if (typeof entry.message.content === 'string') {
                  assistantText = entry.message.content;
                }

                // Additional filter for assistant messages with system content
                const isSystemAssistantMessage = typeof assistantText === 'string' && (
                  assistantText.startsWith('Invalid API key') ||
                  assistantText.includes('{"subtasks":') ||
                  assistantText.includes('CRITICAL: You MUST respond with ONLY a JSON')
                );

                if (assistantText && !isSystemAssistantMessage) {
                  session.lastAssistantMessage = assistantText;
                }
              }
            }

            session.messageCount++;

            if (entry.timestamp) {
              session.lastActivity = new Date(entry.timestamp);
            }
          }
        } catch (parseError) {
          // Skip malformed lines silently
        }
      }
    }

    // After processing all entries, set final summary based on last message if no summary exists
    for (const session of sessions.values()) {
      if (session.summary === 'New Session') {
        // Prefer last user message, fall back to last assistant message
        const lastMessage = session.lastUserMessage || session.lastAssistantMessage;
        if (lastMessage) {
          session.summary = lastMessage.length > 50 ? lastMessage.substring(0, 50) + '...' : lastMessage;
        }
      }
    }

    // Filter out ghost sessions and invalid sessions
    const allSessions = Array.from(sessions.values());
    const filteredSessions = allSessions.filter(session => {
      // Filter out Task Master JSON responses
      if (session.summary.startsWith('{ "')) {
        return false;
      }

      // Filter out ghost sessions (only Warmup, no real user/assistant messages)
      // Ghost sessions are created by Web UI remote-control or repeated CLI warmups
      // See: https://github.com/anthropics/claude-code/issues/29205
      if (!session.lastUserMessage && !session.lastAssistantMessage) {
        return false;
      }

      return true;
    });


    return {
      sessions: filteredSessions,
      entries: entries
    };

  } catch (error) {
    console.error('Error reading JSONL file:', error);
    return { sessions: [], entries: [] };
  }
}

// Extract displayable text from a parsed JSONL entry, applying the same
// system/command-message filtering as parseJsonlSessions. Returns
// { role, text } or null. Shared by the head/tail large-file reader.
function extractEntryText(entry) {
  const msg = entry.message;
  if (!msg || !msg.content) return null;

  if (msg.role === 'user') {
    let text = msg.content;
    if (Array.isArray(text) && text.length > 0 && text[0].type === 'text') text = text[0].text;
    if (typeof text !== 'string' || text.length === 0) return null;
    const isSystem =
      text.startsWith('<command-name>') || text.startsWith('<command-message>') ||
      text.startsWith('<command-args>') || text.startsWith('<local-command-stdout>') ||
      text.startsWith('<system-reminder>') || text.startsWith('Caveat:') ||
      text.startsWith('This session is being continued from a previous') ||
      text.startsWith('Invalid API key') || text.includes('{"subtasks":') ||
      text.includes('CRITICAL: You MUST respond with ONLY a JSON') || text === 'Warmup';
    return isSystem ? null : { role: 'user', text };
  }

  if (msg.role === 'assistant') {
    if (entry.isApiErrorMessage === true) return null;
    let text = null;
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) if (part.type === 'text' && part.text) text = part.text;
    } else if (typeof msg.content === 'string') {
      text = msg.content;
    }
    if (typeof text !== 'string' || text.length === 0) return null;
    const isSystem =
      text.startsWith('Invalid API key') || text.includes('{"subtasks":') ||
      text.includes('CRITICAL: You MUST respond with ONLY a JSON');
    return isSystem ? null : { role: 'assistant', text };
  }

  return null;
}

// Derive session metadata for a large session file WITHOUT reading it whole.
// Reads only the head (first user message for grouping + cwd + optional explicit
// summary) and the tail (last user/assistant message + lastActivity), and
// estimates messageCount from file size. Returns the same { sessions, entries }
// shape as parseJsonlSessions so getSessions' grouping/filtering is unchanged.
async function readLargeSessionMeta(filePath, fileName, size) {
  const sessionId = fileName.replace(/\.jsonl$/, '');
  const HEAD_BYTES = 64 * 1024;
  const TAIL_BYTES = 128 * 1024;

  try {
    const fd = await fs.open(filePath, 'r');
    let headStr, tailStr;
    try {
      const headLen = Math.min(size, HEAD_BYTES);
      const headBuf = Buffer.alloc(headLen);
      await fd.read(headBuf, 0, headLen, 0);
      headStr = headBuf.toString('utf8');

      const tailLen = Math.min(size, TAIL_BYTES);
      const tailBuf = Buffer.alloc(tailLen);
      await fd.read(tailBuf, 0, tailLen, size - tailLen);
      tailStr = tailBuf.toString('utf8');
    } finally {
      await fd.close();
    }

    // HEAD — drop trailing partial line. Find cwd, explicit summary, first user message.
    const headLines = headStr.split('\n');
    if (size > HEAD_BYTES) headLines.pop();
    let cwd = '';
    let explicitSummary = null;
    let firstUserEntry = null;
    let firstUserText = null;
    let headBytes = 0;
    let headCount = 0;
    for (const line of headLines) {
      headBytes += Buffer.byteLength(line) + 1;
      if (!line.trim()) continue;
      headCount++;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!cwd && entry.cwd) cwd = entry.cwd;
      if (!explicitSummary && entry.type === 'summary' && entry.summary) explicitSummary = entry.summary;
      if (!firstUserEntry && entry.sessionId && entry.type === 'user'
          && entry.parentUuid === null && entry.uuid) {
        firstUserEntry = entry;
        const t = extractEntryText(entry);
        if (t) firstUserText = t.text;
      }
    }

    // TAIL — drop leading partial line. Find last user/assistant text + lastActivity.
    const tailLines = tailStr.split('\n');
    if (size > TAIL_BYTES) tailLines.shift();
    let lastUserMessage = null;
    let lastAssistantMessage = null;
    let lastActivity = null;
    for (const line of tailLines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.timestamp) lastActivity = new Date(entry.timestamp);
      const t = extractEntryText(entry);
      if (t?.role === 'user') lastUserMessage = t.text;
      else if (t?.role === 'assistant') lastAssistantMessage = t.text;
    }

    // Fallbacks so a real (non-ghost) large session never disappears from the list.
    if (!lastUserMessage && firstUserText) lastUserMessage = firstUserText;
    if (!lastActivity) {
      try { lastActivity = (await fs.stat(filePath)).mtime; } catch { lastActivity = new Date(); }
    }

    let summary = explicitSummary;
    if (!summary) {
      const base = lastUserMessage || lastAssistantMessage || firstUserText;
      if (base) summary = base.length > 50 ? base.substring(0, 50) + '...' : base;
    }
    if (!summary) summary = 'New Session';

    // messageCount is a cosmetic badge — estimate from avg line size in the head.
    const avgLine = headCount > 0 ? headBytes / headCount : 0;
    const messageCount = avgLine > 0 ? Math.round(size / avgLine) : 0;

    const session = {
      id: sessionId,
      summary,
      messageCount,
      lastActivity,
      cwd,
      lastUserMessage,
      lastAssistantMessage,
    };
    return { sessions: [session], entries: firstUserEntry ? [firstUserEntry] : [] };
  } catch (error) {
    console.error('Error reading large session meta:', filePath, error.message);
    return { sessions: [], entries: [] };
  }
}

// Get messages for a specific session with pagination support
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0) {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);

  try {
    // OPTIMIZATION: Directly read the session file by sessionId instead of scanning all files
    // Claude stores each session in a file named {sessionId}.jsonl
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    // Keep only the tail window the caller will actually return. Loading every
    // entry of a multi-hundred-MB session JSONL into this array OOMs the process
    // (see docs/dev-logs/troubleshooting/2026-06-01-desktop-mode-oom-crash-loop.md).
    const keep = limit === null ? Infinity : offset + limit;
    let total = 0;
    const messages = [];
    const collect = (entry) => {
      total++;
      messages.push(entry);
      if (messages.length > keep) messages.shift();
    };

    try {
      // Check if the session file exists
      await fs.access(sessionFile);

      // Read only the target session file
      const fileStream = fsSync.createReadStream(sessionFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            // Double-check sessionId matches (defensive, should always match)
            if (entry.sessionId === sessionId) {
              collect(entry);
            }
          } catch (parseError) {
            console.warn('Error parsing line:', parseError.message);
          }
        }
      }
    } catch (accessError) {
      // Session file doesn't exist - fall back to scanning all files (legacy behavior)
      if (accessError.code === 'ENOENT') {
        const files = await fs.readdir(projectDir);
        const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

        if (jsonlFiles.length === 0) {
          return { messages: [], total: 0, hasMore: false };
        }

        // Process all JSONL files to find messages for this session
        for (const file of jsonlFiles) {
          const jsonlFile = path.join(projectDir, file);
          const fileStream = fsSync.createReadStream(jsonlFile);
          const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
          });

          for await (const line of rl) {
            if (line.trim()) {
              try {
                const entry = JSON.parse(line);
                if (entry.sessionId === sessionId) {
                  collect(entry);
                }
              } catch (parseError) {
                console.warn('Error parsing line:', parseError.message);
              }
            }
          }
        }
      } else {
        throw accessError;
      }
    }

    // Sort messages by timestamp
    const sortedMessages = messages.sort((a: any, b: any) =>
      (new Date(a.timestamp || 0) as any) - (new Date(b.timestamp || 0) as any)
    );

    // If no limit is specified, return all messages (backward compatibility)
    if (limit === null) {
      return sortedMessages;
    }

    // `messages` is already bounded to the last (offset+limit) entries, so slice
    // within that window. `total` is the true count tracked during streaming.
    const windowLen = sortedMessages.length;
    const startIndex = Math.max(0, windowLen - offset - limit);
    const endIndex = Math.max(0, windowLen - offset);
    const paginatedMessages = sortedMessages.slice(startIndex, endIndex);
    const hasMore = (total - offset - limit) > 0;

    return {
      messages: paginatedMessages,
      total,
      hasMore,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return limit === null ? [] : { messages: [], total: 0, hasMore: false };
  }
}

// Rename a project's display name
async function renameProject(projectName, newDisplayName) {
  const config = await loadProjectConfig();
  
  if (!newDisplayName || newDisplayName.trim() === '') {
    // Remove custom name if empty, will fall back to auto-generated
    delete config[projectName];
  } else {
    // Set custom display name
    config[projectName] = {
      displayName: newDisplayName.trim()
    };
  }
  
  await saveProjectConfig(config);
  return true;
}

// Delete a session from a project
async function deleteSession(projectName, sessionId) {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      throw new Error('No session files found for this project');
    }
    
    // Check all JSONL files to find which one contains the session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Check if this file contains the session
      const hasSession = lines.some(line => {
        try {
          const data = JSON.parse(line);
          return data.sessionId === sessionId;
        } catch {
          return false;
        }
      });
      
      if (hasSession) {
        // Filter out all entries for this session
        const filteredLines = lines.filter(line => {
          try {
            const data = JSON.parse(line);
            return data.sessionId !== sessionId;
          } catch {
            return true; // Keep malformed lines
          }
        });
        
        // Write back the filtered content
        await fs.writeFile(jsonlFile, filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : ''));
        return true;
      }
    }
    
    throw new Error(`Session ${sessionId} not found in any files`);
  } catch (error) {
    console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}

// Check if a project is empty (has no sessions)
async function isProjectEmpty(projectName) {
  try {
    const sessionsResult = await getSessions(projectName, 1, 0);
    return sessionsResult.total === 0;
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Delete an empty project
async function deleteProject(projectName) {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  
  try {
    // First check if the project is empty
    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty) {
      throw new Error('Cannot delete project with existing sessions');
    }
    
    // Remove the project directory
    await fs.rm(projectDir, { recursive: true, force: true });
    
    // Remove from project config
    const config = await loadProjectConfig();
    delete config[projectName];
    await saveProjectConfig(config);
    
    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

// Add a project manually to the config (without creating folders)
async function addProjectManually(projectPath, displayName = null) {
  const absolutePath = path.resolve(projectPath);
  
  try {
    // Check if the path exists
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }
  
  // Generate project name (encode path for use as directory name)
  const projectName = absolutePath.replace(/\//g, '-');
  
  // Check if project already exists in config
  const config = await loadProjectConfig();
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);

  if (config[projectName]) {
    throw new Error(`Project already configured for path: ${absolutePath}`);
  }

  // Allow adding projects even if the directory exists - this enables tracking
  // existing Claude Code or Cursor projects in the UI
  
  // Add to config as manually added project
  config[projectName] = {
    manuallyAdded: true,
    originalPath: absolutePath
  };
  
  if (displayName) {
    config[projectName].displayName = displayName;
  }
  
  await saveProjectConfig(config);
  
  
  return {
    name: projectName,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    isManuallyAdded: true,
    sessions: [],
    cursorSessions: []
  };
}

// Fetch Cursor sessions for a given project path
async function getCursorSessions(projectPath) {
  try {
    // Calculate cwdID hash for the project path (Cursor uses MD5 hash)
    const cwdId = crypto.createHash('md5').update(projectPath).digest('hex');
    const cursorChatsPath = path.join(os.homedir(), '.cursor', 'chats', cwdId);
    
    // Check if the directory exists
    try {
      await fs.access(cursorChatsPath);
    } catch (error) {
      // No sessions for this project
      return [];
    }
    
    // List all session directories
    const sessionDirs = await fs.readdir(cursorChatsPath);
    const sessions = [];
    
    for (const sessionId of sessionDirs) {
      const sessionPath = path.join(cursorChatsPath, sessionId);
      const storeDbPath = path.join(sessionPath, 'store.db');
      
      try {
        // Check if store.db exists
        await fs.access(storeDbPath);
        
        // Capture store.db mtime as a reliable fallback timestamp
        let dbStatMtimeMs = null;
        try {
          const stat = await fs.stat(storeDbPath);
          dbStatMtimeMs = stat.mtimeMs;
        } catch (_) {}

        // Open SQLite database
        const db = await open({
          filename: storeDbPath,
          driver: sqlite3.Database,
          mode: sqlite3.OPEN_READONLY
        });
        
        // Get metadata from meta table
        const metaRows = await db.all(`
          SELECT key, value FROM meta
        `);
        
        // Parse metadata
        let metadata: any = {};
        for (const row of metaRows) {
          if (row.value) {
            try {
              // Try to decode as hex-encoded JSON
              const hexMatch = row.value.toString().match(/^[0-9a-fA-F]+$/);
              if (hexMatch) {
                const jsonStr = Buffer.from(row.value, 'hex').toString('utf8');
                metadata[row.key] = JSON.parse(jsonStr);
              } else {
                metadata[row.key] = row.value.toString();
              }
            } catch (e) {
              metadata[row.key] = row.value.toString();
            }
          }
        }
        
        // Get message count
        const messageCountResult = await db.get(`
          SELECT COUNT(*) as count FROM blobs
        `);
        
        await db.close();
        
        // Extract session info
        const sessionName = metadata.title || metadata.sessionTitle || 'Untitled Session';
        
        // Determine timestamp - prefer createdAt from metadata, fall back to db file mtime
        let createdAt = null;
        if (metadata.createdAt) {
          createdAt = new Date(metadata.createdAt).toISOString();
        } else if (dbStatMtimeMs) {
          createdAt = new Date(dbStatMtimeMs).toISOString();
        } else {
          createdAt = new Date().toISOString();
        }
        
        sessions.push({
          id: sessionId,
          name: sessionName,
          createdAt: createdAt,
          lastActivity: createdAt, // For compatibility with Claude sessions
          messageCount: messageCountResult.count || 0,
          projectPath: projectPath
        });
        
      } catch (error) {
        console.warn(`Could not read Cursor session ${sessionId}:`, error.message);
      }
    }
    
    // Sort sessions by creation time (newest first)
    sessions.sort((a: any, b: any) => (new Date(b.createdAt) as any) - (new Date(a.createdAt) as any));
    
    // Return only the first 5 sessions for performance
    return sessions.slice(0, 5);
    
  } catch (error) {
    console.error('Error fetching Cursor sessions:', error);
    return [];
  }
}


export {
  getProjects,
  getProjectsBasic,
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  deleteSession,
  isProjectEmpty,
  deleteProject,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache
};
