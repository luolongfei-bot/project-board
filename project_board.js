const STORAGE_KEY = 'project-board-v3';

// Sample Data Structure
// Hierarchy: Project (Parent) Modules -> Core Functional Modules (Sub) -> Tasks
const defaultData = {
    project: {
        name: "演示大事件",
    },
    parentModules: [
        { id: 'pm1', name: '阶段一：基础设施建设' },
        { id: 'pm2', name: '阶段二：业务功能开发' }
    ],
    modules: [
        { id: 'm1', parentId: 'pm1', name: '用户中心', color: '#ff6b6b', startDate: '2023-11-01', endDate: '2023-11-15' },
        { id: 'm2', parentId: 'pm2', name: '支付中台', color: '#4facfe', startDate: '2023-11-16', endDate: '2023-11-30' },
        { id: 'm3', parentId: 'pm2', name: '数据引擎', color: '#5bc17f', startDate: '2023-12-01', endDate: '2023-12-20' }
    ],
    tasks: [
        { 
            id: 't1', 
            content: '用户登录注册API', 
            moduleId: 'm1', 
            status: 'done',
            startDate: '2023-11-01',
            endDate: '2023-11-05',
            duration: 5,
            dependencies: []
        },
        { 
            id: 't2', 
            content: 'OAuth2.0 集成', 
            moduleId: 'm1', 
            status: 'doing',
            startDate: '2023-11-06',
            endDate: '2023-11-10',
            duration: 5,
            dependencies: ['t1'] 
        },
        { 
            id: 't3', 
            content: '支付网关对接', 
            moduleId: 'm2', 
            status: 'pending', 
            startDate: '2023-11-16',
            endDate: '2023-11-20',
            duration: 5,
            dependencies: ['t1'] 
        }
    ]
};

let data = JSON.parse(JSON.stringify(defaultData));
let currentView = 'board'; 
let ganttInstance = null;
let ganttMode = 'Day';

// --- Cloud Sync Logic (JSONBin & Custom) ---
const SERVER_BASE = window.location.protocol === 'file:' ? 'http://localhost:8000' : '';
const LOCAL_API_URL = `${SERVER_BASE}/api/data`;
const LOCAL_HEALTH_URL = `${SERVER_BASE}/api/health`;

let useServer = false;
let currentCloudConfig = null; // { type: 'jsonbin', binId, apiKey } or { type: 'custom', url }

// Load Cloud Config from LocalStorage
try {
    const savedConfig = localStorage.getItem('cloud-config');
    if (savedConfig) {
        currentCloudConfig = JSON.parse(savedConfig);
    } else {
        // Auto-configure with provided credentials
        currentCloudConfig = {
            type: 'jsonbin',
            binId: '692ff62eae596e708f804387',
            apiKey: '$2a$10$6XjqsiDTFWsfHa5EnTtgWuuLPhUikpZ.P4y3qIWyDS69ajtAcfJWO'
        };
        localStorage.setItem('cloud-config', JSON.stringify(currentCloudConfig));
    }
} catch(e) {}

async function checkServer() {
    // 1. Check Cloud First
    if (currentCloudConfig) {
        useServer = true; // Treat cloud as "Server"
        updateConnectionStatus();
        return;
    }

    // 2. Fallback to Local Server
    try {
        const res = await fetch(LOCAL_HEALTH_URL);
        useServer = res.ok;
    } catch (e) {
        useServer = false;
    }
    updateConnectionStatus();
}

async function fetchFromCloud() {
    if (!currentCloudConfig) return null;

    try {
        if (currentCloudConfig.type === 'jsonbin') {
            const res = await fetch(`https://api.jsonbin.io/v3/b/${currentCloudConfig.binId}/latest`, {
                headers: {
                    'X-Master-Key': currentCloudConfig.apiKey
                }
            });
            if (!res.ok) throw new Error('JSONBin Error');
            const json = await res.json();
            return json.record; // JSONBin v3 wraps data in "record"
        } else if (currentCloudConfig.type === 'custom') {
            const res = await fetch(currentCloudConfig.url);
            if (!res.ok) throw new Error('Custom API Error');
            return await res.json();
        }
    } catch (e) {
        console.error("Cloud Fetch Error", e);
        alert("无法连接到云端存储，请检查配置！");
        return null;
    }
}

async function saveToCloud(dataToSave) {
    if (!currentCloudConfig) return false;

    try {
        if (currentCloudConfig.type === 'jsonbin') {
            const res = await fetch(`https://api.jsonbin.io/v3/b/${currentCloudConfig.binId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Master-Key': currentCloudConfig.apiKey
                },
                body: JSON.stringify(dataToSave)
            });
            return res.ok;
        } else if (currentCloudConfig.type === 'custom') {
            const res = await fetch(currentCloudConfig.url, {
                method: 'POST', // Assume POST for custom
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSave)
            });
            return res.ok;
        }
    } catch (e) {
        console.error("Cloud Save Error", e);
        return false;
    }
}

function updateConnectionStatus() {
    let statusEl = document.getElementById('connectionStatus');
    if (!statusEl) {
        const header = document.querySelector('.header-left');
        statusEl = document.createElement('div');
        statusEl.id = 'connectionStatus';
        statusEl.className = 'status-badge';
        statusEl.style.marginLeft = '15px';
        statusEl.style.fontSize = '0.9rem';
        statusEl.style.padding = '4px 8px';
        statusEl.style.borderRadius = '4px';
        header.appendChild(statusEl);
    }

    if (currentCloudConfig) {
        statusEl.textContent = '☁️ 已连接云端 (互联网模式)';
        statusEl.style.backgroundColor = '#cce5ff';
        statusEl.style.color = '#004085';
        statusEl.title = `数据存储在: ${currentCloudConfig.type}`;
    } else if (useServer) {
        statusEl.textContent = '🟢 已连接服务器 (局域网模式)';
        statusEl.style.backgroundColor = '#d4edda';
        statusEl.style.color = '#155724';
        statusEl.title = '数据实时保存在本地服务器';
    } else {
        statusEl.textContent = '⚪ 本地单机模式';
        statusEl.style.backgroundColor = '#f8f9fa';
        statusEl.style.color = '#6c757d';
        statusEl.title = '数据仅保存在您的浏览器中';
    }
}

// --- Core Logic ---

async function loadData() {
    await checkServer();
    
    let serverData = null;
    
    // Try Cloud or Local Server
    if (currentCloudConfig) {
        serverData = await fetchFromCloud();
    } else if (useServer) {
        try {
            const res = await fetch(LOCAL_API_URL);
            if (res.ok) serverData = await res.json();
        } catch(e) {}
    }

    let raw = localStorage.getItem(STORAGE_KEY);
    
    // --- NEW LOGIC: Prioritize Local Data if Server is "New/Default" ---
    
    // Check if local data exists and is "real" (not just a newly initialized default)
    // We can assume if it has custom tasks or project name, it's real.
    let localIsReal = false;
    let localData = null;
    if (raw) {
        try {
            localData = JSON.parse(raw);
            if (localData.tasks && localData.tasks.length > 0) localIsReal = true;
            if (localData.project && localData.project.name !== "演示大事件" && localData.project.name !== "未命名项目") localIsReal = true;
        } catch(e) {}
    }

    // Check if server data is effectively "empty/default"
    // The Python server initializes with "未命名项目" and empty tasks.
    const isServerDefault = serverData && 
                            serverData.project.name === "未命名项目" && 
                            (!serverData.tasks || serverData.tasks.length === 0);

    if ((currentCloudConfig || useServer) && serverData && !isServerDefault) {
        // Server has REAL data -> Use it (standard collaboration flow)
        data = serverData;
        console.log("Loaded data from Server/Cloud");
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return;
    } else if ((currentCloudConfig || useServer) && localIsReal) {
        // Server is empty/default, but we have local data -> Use Local & SYNC TO SERVER
        data = localData;
        console.log("Loaded local data, pushing to server...");
        saveData(); // This pushes to server because useServer is true
        return;
    }

    // Fallback to Local Storage if server didn't provide better data
    // Check if current data is just the default sample
    let isSample = false;
    if (raw) {
        try {
            const current = JSON.parse(raw);
            // Heuristic: if name matches and task count matches sample
            if (current.project && current.project.name === "演示大事件" && 
                current.tasks && current.tasks.length === 3 && current.tasks[0].id === 't1') {
                isSample = true;
            }
        } catch(e) {}
    }

    // Migration Logic: Check for V2 or V1 data if V3 is empty or sample
    if (!raw || isSample) {
        // Try V2
        const v2Raw = localStorage.getItem('project-board-v2');
        if (v2Raw) {
            try {
                console.log("Migrating data from v2 to v3...");
                const v2Data = JSON.parse(v2Raw);
                migrateV2ToV3(v2Data);
                return;
            } catch (e) {
                console.error("Migration v2 failed", e);
            }
        }

        // Try V1
        const v1Raw = localStorage.getItem('project-board-v1');
        if (v1Raw) {
             try {
                console.log("Migrating data from v1 to v3...");
                const v1Data = JSON.parse(v1Raw);
                migrateV1ToV3(v1Data);
                return;
            } catch (e) {
                console.error("Migration v1 failed", e);
            }
        }
    }

    if (raw) {
        try {
            data = JSON.parse(raw);
            if (!data.project) data.project = { name: 'Project Flow' };
            if (!data.parentModules) data.parentModules = [];
            if (!data.modules) data.modules = [];
            if (!data.tasks) data.tasks = [];
            
            // Integrity: Assign orphaned modules to a default parent
            if (data.modules.length > 0 && data.parentModules.length === 0) {
                const defaultParent = { id: 'pm_default', name: '默认项目模块' };
                data.parentModules.push(defaultParent);
                data.modules.forEach(m => {
                    if (!m.parentId) m.parentId = 'pm_default';
                });
            }
        } catch (e) {
            console.error('Failed to parse data', e);
        }
    }
}

function migrateV2ToV3(v2Data) {
    if (!v2Data.parentModules) {
        v2Data.parentModules = [
            { id: 'pm_default', name: '默认项目模块' }
        ];
    }
    if (v2Data.modules) {
        v2Data.modules.forEach(m => {
            if (!m.parentId) m.parentId = 'pm_default';
        });
    }
    data = v2Data;
    if (!data.tasks) data.tasks = [];
    saveData();
    alert("已成功恢复并迁移 V2 版本数据！");
}

function migrateV1ToV3(v1Data) {
    // V1 Structure: { modules: [], stages: [], tasks: [] }
    // Strategy: Stages -> V3 Modules (Columns).
    
    const newParent = { id: 'pm_rec', name: '恢复的旧版数据' };
    const newModules = [];
    
    // Map V1 Stages to V3 Modules
    if (v1Data.stages) {
        v1Data.stages.forEach(s => {
            newModules.push({
                id: s.id, // Keep ID to map tasks
                parentId: 'pm_rec',
                name: s.name,
                startDate: s.date || '',
                endDate: '',
                color: '#5bc17f'
            });
        });
    }

    // Map V1 Tasks
    // V1 Task: { id, content, stageId, moduleId, ... }
    // V3 Task: { id, content, moduleId (was stageId), ... }
    const newTasks = [];
    if (v1Data.tasks) {
        v1Data.tasks.forEach(t => {
            // Prepend old module tag to content if exists
            let content = t.content;
            if (t.moduleId && v1Data.modules) {
                const oldMod = v1Data.modules.find(m => m.id === t.moduleId);
                if (oldMod) content = `[${oldMod.name}] ${content}`;
            }

            newTasks.push({
                id: t.id,
                content: content,
                moduleId: t.stageId, // Map to new module (old stage)
                status: t.status || 'pending',
                startDate: t.startDate || '',
                endDate: t.endDate || '',
                duration: t.duration || 1,
                dependencies: t.dependencies || []
            });
        });
    }

    data = {
        project: { name: '恢复的项目' },
        parentModules: [newParent],
        modules: newModules,
        tasks: newTasks
    };
    
    saveData();
    alert("已成功恢复并迁移 V1 版本数据！");
}

async function saveData() {
    // Always save to local storage as backup/cache
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    
    if (currentCloudConfig) {
        const ok = await saveToCloud(data);
        if (!ok) {
            const statusEl = document.getElementById('connectionStatus');
            if (statusEl) statusEl.textContent = '⚠️ 云端同步失败';
        } else {
            updateConnectionStatus();
        }
    } else if (useServer) {
        try {
            await fetch(LOCAL_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            updateConnectionStatus(); // Update status/icon to show synced?
        } catch (e) {
            console.error("Failed to save to server", e);
            const statusEl = document.getElementById('connectionStatus');
            if (statusEl) statusEl.textContent = '⚠️ 同步失败 (保存于本地)';
        }
    }
    render();
}

function getTodayString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function checkDependencies(task) {
    if (!task.dependencies || task.dependencies.length === 0) {
        return { status: 'ok', blockedBy: [], riskBy: [] };
    }
    
    const today = getTodayString();
    const blockedBy = [];
    const riskBy = [];
    const taskNeedsStart = task.startDate && task.startDate <= today;

    task.dependencies.forEach(depId => {
        const depTask = data.tasks.find(t => t.id === depId);
        if (!depTask) return; 

        if (depTask.status === 'done') return;

        if (taskNeedsStart) {
            blockedBy.push(depTask.content);
        }

        if (depTask.endDate && depTask.endDate < today) {
            riskBy.push(depTask.content);
        }
    });

    let status = 'ok';
    if (blockedBy.length > 0) status = 'blocked';
    else if (riskBy.length > 0) status = 'risk';

    return { status, blockedBy, riskBy };
}

// --- View Switching ---

document.getElementById('viewBoardBtn').addEventListener('click', () => switchView('board'));
document.getElementById('viewGanttBtn').addEventListener('click', () => switchView('gantt'));

function switchView(view) {
    currentView = view;
    document.getElementById('viewBoardBtn').classList.toggle('active', view === 'board');
    document.getElementById('viewGanttBtn').classList.toggle('active', view === 'gantt');
    
    document.getElementById('boardContainer').style.display = view === 'board' ? 'flex' : 'none';
    document.getElementById('ganttContainer').style.display = view === 'gantt' ? 'flex' : 'none';

    render();
}

// --- Rendering ---

function render() {
    // Update Project Title
    const titleEl = document.getElementById('projectNameDisplay');
    if (titleEl) {
        titleEl.textContent = (data.project && data.project.name) ? `🚀 ${data.project.name}` : '🚀 Project Flow';
    }

    if (currentView === 'board') {
        renderBoard();
    } else {
        renderGantt();
    }
}

function renderBoard() {
    const container = document.getElementById('boardContainer');
    container.innerHTML = '';

    // Render by Parent Module Groups
    data.parentModules.forEach(pm => {
        const groupEl = document.createElement('div');
        groupEl.className = 'module-group';
        
        const header = document.createElement('div');
        header.className = 'module-group-header';
        header.innerHTML = `
            <span>📁 ${pm.name}</span>
            <div style="display:flex;gap:4px;">
                <button class="icon-btn edit-parent" data-id="${pm.id}" title="修改名称">✎</button>
                <button class="icon-btn delete-parent" data-id="${pm.id}" title="删除项目模块">×</button>
            </div>
        `;
        // Wire up delete button later
        
        const columnsContainer = document.createElement('div');
        columnsContainer.className = 'module-group-columns';

        // Find sub-modules
        const subModules = data.modules.filter(m => m.parentId === pm.id);
        // Sort sub-modules by date
        subModules.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

        subModules.forEach(module => {
            const col = renderModuleColumn(module);
            columnsContainer.appendChild(col);
        });

        groupEl.appendChild(header);
        groupEl.appendChild(columnsContainer);
        container.appendChild(groupEl);
    });

    // Bind delete parent buttons
    container.querySelectorAll('.delete-parent').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            deleteParentModule(btn.dataset.id);
        };
    });

    // Bind edit parent buttons
    container.querySelectorAll('.edit-parent').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            editParentModule(btn.dataset.id);
        };
    });
}

function renderModuleColumn(module) {
    const column = document.createElement('div');
    column.className = 'module-column';
    column.style.borderTopColor = module.color;
    
    const header = document.createElement('div');
    header.className = 'module-header';
    header.onclick = () => openModuleModal(module.id);
    
    const title = document.createElement('div');
    title.className = 'module-title';
    title.innerHTML = `<span>${module.name}</span> <span style="font-size:0.8rem;opacity:0.6;">${getModuleStats(module.id)}</span>`;
    
    const dates = document.createElement('div');
    dates.className = 'module-dates';
    dates.innerHTML = `📅 ${module.startDate || 'TBD'} ~ ${module.endDate || 'TBD'}`;
    
    header.appendChild(title);
    header.appendChild(dates);
    column.appendChild(header);

    const body = document.createElement('div');
    body.className = 'module-body';

    const tasksInModule = data.tasks.filter(t => t.moduleId === module.id);
    tasksInModule.forEach(task => {
        const card = createTaskElement(task, module);
        body.appendChild(card);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-task-btn';
    addBtn.textContent = '+ 添加任务';
    addBtn.onclick = () => openTaskModal(null, module.id);
    
    body.appendChild(addBtn);
    column.appendChild(body);
    return column;
}

function getModuleStats(moduleId) {
    const tasks = data.tasks.filter(t => t.moduleId === moduleId);
    const total = tasks.length;
    if (total === 0) return '';
    const done = tasks.filter(t => t.status === 'done').length;
    return `${done}/${total}`;
}

function createTaskElement(task, module) {
    const depCheck = checkDependencies(task);
    const today = getTodayString();
    
    let cardClass = `task-card ${task.status}`;
    if (task.status !== 'done') {
        if (depCheck.status === 'blocked') cardClass += ' blocked';
        else if (depCheck.status === 'risk') cardClass += ' risk';
        if (task.endDate === today) cardClass += ' due-today';
    }

    const card = document.createElement('div');
    card.className = cardClass;

    card.onclick = (e) => {
        if (!e.target.classList.contains('task-checkbox')) {
            openTaskModal(task.id);
        }
    };

    const headerRow = document.createElement('div');
    headerRow.className = 'task-header-row';

    const checkbox = document.createElement('div');
    checkbox.className = `task-checkbox ${task.status === 'done' ? 'checked' : ''}`;
    checkbox.onclick = (e) => {
        e.stopPropagation();
        toggleTaskStatus(task.id);
    };

    headerRow.appendChild(checkbox);
    card.appendChild(headerRow);

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.content;
    card.appendChild(title);

    const bottom = document.createElement('div');
    bottom.className = 'task-meta-bottom';
    
    let dateInfo = '';
    if (task.endDate) {
        if (task.status !== 'done' && task.endDate === today) {
            dateInfo = `<span style="color:var(--info);font-weight:bold;">🔥 今天截止</span>`;
        } else {
            dateInfo = `⏱️ ${task.endDate.slice(5)}`;
        }
    }
    
    let depInfo = '';
    if (task.status !== 'done') {
        if (depCheck.status === 'blocked') {
            depInfo = `<span class="dep-badge blocked" title="阻塞原因: ${depCheck.blockedBy.join(', ')}">⛔ 阻塞</span>`;
        } else if (depCheck.status === 'risk') {
            depInfo = `<span class="dep-badge risk" title="风险原因: ${depCheck.riskBy.join(', ')}">⚠️ 风险</span>`;
        } else if (task.dependencies && task.dependencies.length > 0) {
            depInfo = `<span class="dep-badge" title="依赖项正常">🔗 ${task.dependencies.length}</span>`;
        }
    }

    bottom.innerHTML = `<span>${dateInfo}</span>${depInfo}`;
    card.appendChild(bottom);

    return card;
}

function toggleTaskStatus(taskId) {
    const task = data.tasks.find(t => t.id === taskId);
    if (task) {
        task.status = task.status === 'done' ? 'pending' : 'done';
        saveData();
    }
}

// --- Gantt Logic ---

function renderGantt() {
    // Dynamic CSS
    let styleTag = document.getElementById('gantt-dynamic-styles');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'gantt-dynamic-styles';
        document.head.appendChild(styleTag);
    }
    
    let cssRules = '';
    data.modules.forEach(m => {
        const safeId = m.id.replace(/[^a-zA-Z0-9-_]/g, '');
        cssRules += `
            .gantt .bar-wrapper.module-${safeId} .bar { fill: ${m.color} !important; }
            .gantt .bar-wrapper.module-${safeId} .bar-progress { fill: rgba(255,255,255,0.3) !important; }
        `;
    });
    styleTag.innerHTML = cssRules;

    const ganttTasks = [];

    // Group by Parent Module -> Sub Module -> Tasks
    data.parentModules.forEach(pm => {
        // We could add a bar for Parent Module, but let's focus on Core Modules
        // Maybe just tasks, sorted by Parent/Sub logic
        const subModules = data.modules.filter(m => m.parentId === pm.id);
        
        subModules.forEach(m => {
            // Module Summary Bar
            if (m.startDate && m.endDate) {
                ganttTasks.push({
                    id: `MOD_${m.id}`,
                    name: `${pm.name} / ${m.name}`,
                    start: m.startDate,
                    end: m.endDate,
                    progress: 0,
                    dependencies: '',
                    custom_class: `module-${m.id} summary-bar`,
                    _isModule: true,
                    _original: m
                });
            }

            // Tasks
            const moduleTasks = data.tasks.filter(t => t.moduleId === m.id);
            moduleTasks.forEach(t => {
                let start = t.startDate || m.startDate || getTodayString();
                let end = t.endDate;
                
                if (!end) {
                    const d = new Date(start);
                    d.setDate(d.getDate() + (parseInt(t.duration) || 1));
                    end = d.toISOString().split('T')[0];
                }

                let progress = 0;
                if (t.status === 'done') progress = 100;
                else if (t.status === 'doing') progress = 50;

                ganttTasks.push({
                    id: t.id,
                    name: t.content,
                    start: start,
                    end: end,
                    progress: progress,
                    dependencies: t.dependencies ? t.dependencies.join(',') : '',
                    custom_class: `module-${m.id}`,
                    _original: t
                });
            });
        });
    });

    if (ganttTasks.length === 0) {
        document.getElementById('gantt').innerHTML = '<text x="50" y="50" fill="#9aa1b5">暂无数据。</text>';
        return;
    }

    document.querySelector('.gantt-wrapper').innerHTML = '<svg id="gantt"></svg>';

    ganttInstance = new Gantt("#gantt", ganttTasks, {
        header_height: 50,
        column_width: 30,
        step: 24,
        view_modes: ['Day', 'Week', 'Month'],
        bar_height: 25,
        bar_corner_radius: 3,
        arrow_curve: 5,
        padding: 18,
        view_mode: ganttMode,
        date_format: 'YYYY-MM-DD',
        language: 'zh',
        custom_popup_html: function(task) {
            const typeLabel = task.id.startsWith('MOD_') ? '核心功能' : '任务';
            return `
                <div class="popup-wrapper">
                    <div class="title">${typeLabel}: ${task.name}</div>
                    <div class="subtitle">
                        <div>时间: ${task.start} - ${task.end}</div>
                    </div>
                </div>
            `;
        },
        on_click: function (task) {
            if (task.id.startsWith('MOD_')) {
                openModuleModal(task._original.id);
            } else {
                openTaskModal(task.id);
            }
        },
        on_date_change: function(task, start, end) {
            const formatDate = (d) => {
                const offset = d.getTimezoneOffset();
                const local = new Date(d.getTime() - (offset*60*1000));
                return local.toISOString().split('T')[0];
            };
            const s = formatDate(start);
            const e = formatDate(end);

            if (task.id.startsWith('MOD_')) {
                const mod = data.modules.find(m => m.id === task._original.id);
                if (mod) {
                    mod.startDate = s;
                    mod.endDate = e;
                    saveData();
                }
            } else {
                const t = data.tasks.find(x => x.id === task.id);
                if (t) {
                    t.startDate = s;
                    t.endDate = e;
                    const diffTime = Math.abs(end - start);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    t.duration = diffDays;
                    saveData();
                }
            }
        },
        on_view_change: function(mode) { ganttMode = mode; }
    });
}

window.changeGanttMode = function(mode) {
    if (ganttInstance) ganttInstance.change_view_mode(mode);
}

// --- Modals & Data Management ---

let editingTaskId = null;
let editingModuleId = null;

// Data Recovery / Debug
const controls = document.querySelector('.controls');

// Add "Data Recovery" button
const recoveryBtn = document.createElement('button');
recoveryBtn.className = 'btn-secondary';
recoveryBtn.innerHTML = '♻️ 找回数据';
recoveryBtn.onclick = openRecoveryModal;
controls.insertBefore(recoveryBtn, controls.firstChild); // Add to far left

// Add Force Sync button (ensure it's added if not already)
if (!document.getElementById('forceSyncBtn')) {
    const syncBtn = document.createElement('button');
    syncBtn.id = 'forceSyncBtn';
    syncBtn.className = 'btn-secondary';
    syncBtn.innerHTML = '☁️ 强制同步';
    syncBtn.title = '将当前界面数据强制覆盖到服务器';
    syncBtn.style.display = 'none'; // Hidden by default
    syncBtn.onclick = async () => {
        if(confirm('确定要将当前显示的数据覆盖服务器上的数据吗？\n\n注意：这会用您当前屏幕上看到的内容，替换掉服务器上所有人看到的内容。')) {
            await saveData();
            alert('同步完成！所有人都将看到您现在的数据。');
        }
    };
    controls.insertBefore(syncBtn, controls.firstChild);
}

function openRecoveryModal() {
    // Create modal on the fly
    let modal = document.getElementById('recoveryModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'recoveryModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h2>♻️ 数据恢复与同步</h2>
                    <button class="close-modal icon-btn" onclick="document.getElementById('recoveryModal').style.display='none'">×</button>
                </div>
                <div class="modal-body">
                    <p style="color:#666;margin-bottom:15px;">如果您发现数据丢失，可以在这里尝试从本地缓存或旧版本中找回。</p>
                    
                    <div style="border:1px solid #eee; padding:10px; margin-bottom:10px; border-radius:4px;">
                        <h3 style="margin:0 0 10px 0;font-size:1rem;">1. 本地缓存 (V3 - 最新)</h3>
                        <div id="rec-v3-info" style="font-size:0.9rem; color:#444; margin-bottom:5px;">正在检查...</div>
                        <button id="btn-load-v3" class="btn-primary" style="font-size:0.8rem;">从本地缓存加载</button>
                    </div>

                    <div style="border:1px solid #eee; padding:10px; margin-bottom:10px; border-radius:4px;">
                        <h3 style="margin:0 0 10px 0;font-size:1rem;">2. 本地旧版 (V2 - 历史)</h3>
                        <div id="rec-v2-info" style="font-size:0.9rem; color:#444; margin-bottom:5px;">正在检查...</div>
                        <button id="btn-load-v2" class="btn-secondary" style="font-size:0.8rem;">从 V2 恢复</button>
                    </div>
                    
                     <div style="border:1px solid #eee; padding:10px; margin-bottom:10px; border-radius:4px;">
                        <h3 style="margin:0 0 10px 0;font-size:1rem;">3. 服务器数据 (云端)</h3>
                        <div id="rec-server-info" style="font-size:0.9rem; color:#444; margin-bottom:5px;">正在检查...</div>
                        <button id="btn-load-server" class="btn-secondary" style="font-size:0.8rem;">从服务器拉取</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Bind events
        modal.querySelector('#btn-load-v3').onclick = () => restoreFrom('v3');
        modal.querySelector('#btn-load-v2').onclick = () => restoreFrom('v2');
        modal.querySelector('#btn-load-server').onclick = () => restoreFrom('server');
    }
    
    // Check Data Status
    const v3Raw = localStorage.getItem(STORAGE_KEY);
    const v2Raw = localStorage.getItem('project-board-v2');
    
    updateRecInfo('rec-v3-info', v3Raw);
    updateRecInfo('rec-v2-info', v2Raw);
    
    const serverInfoEl = document.getElementById('rec-server-info');
    serverInfoEl.textContent = '正在连接服务器...';
    fetch(API_URL).then(res => res.json()).then(serverData => {
        const count = serverData.tasks ? serverData.tasks.length : 0;
        serverInfoEl.textContent = `项目: ${serverData.project.name} | 任务数: ${count}`;
    }).catch(() => {
        serverInfoEl.textContent = '无法连接服务器';
    });

    modal.style.display = 'flex';
}

function updateRecInfo(id, raw) {
    const el = document.getElementById(id);
    if (!raw) {
        el.textContent = '无数据';
        return;
    }
    try {
        const d = JSON.parse(raw);
        const name = d.project ? d.project.name : 'Unknown';
        const tasks = d.tasks ? d.tasks.length : 0;
        el.textContent = `项目: ${name} | 任务数: ${tasks}`;
    } catch(e) {
        el.textContent = '数据损坏';
    }
}

async function restoreFrom(source) {
    if (!confirm('确定要加载这份数据吗？当前界面未保存的修改将丢失。')) return;
    
    try {
        if (source === 'server') {
            const res = await fetch(API_URL);
            const serverData = await res.json();
            data = serverData;
            alert('已从服务器加载数据！');
        } else if (source === 'v3') {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                data = JSON.parse(raw);
                alert('已从本地缓存(V3)加载数据！');
            } else {
                alert('本地没有 V3 数据');
                return;
            }
        } else if (source === 'v2') {
             const raw = localStorage.getItem('project-board-v2');
            if (raw) {
                const v2Data = JSON.parse(raw);
                migrateV2ToV3(v2Data); // This function handles data assignment and alert
                document.getElementById('recoveryModal').style.display = 'none';
                render();
                return;
            } else {
                alert('本地没有 V2 数据');
                return;
            }
        }
        
        saveData(); // Save to persist this choice (syncs to server if connected)
        document.getElementById('recoveryModal').style.display = 'none';
        render();
        
    } catch(e) {
        alert('加载失败: ' + e.message);
    }
}

// Parent Management
const parentModal = document.getElementById('parentModal');
document.getElementById('manageParentsBtn').addEventListener('click', () => {
    renderParentList();
    parentModal.style.display = 'flex';
});

function renderParentList() {
    const list = document.getElementById('parentList');
    list.innerHTML = '';
    data.parentModules.forEach(pm => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <span>${pm.name}</span>
            <div style="display:flex;gap:4px;">
                <button class="icon-btn edit-pm" data-id="${pm.id}" title="修改">✎</button>
                <button class="icon-btn delete-pm" data-id="${pm.id}">×</button>
            </div>
        `;
        list.appendChild(item);
    });
    
    list.querySelectorAll('.delete-pm').forEach(btn => {
        btn.onclick = () => deleteParentModule(btn.dataset.id);
    });
    list.querySelectorAll('.edit-pm').forEach(btn => {
        btn.onclick = () => editParentModule(btn.dataset.id);
    });
}

document.getElementById('addParentBtn').addEventListener('click', () => {
    const name = document.getElementById('newParentName').value.trim();
    if (name) {
        data.parentModules.push({ id: Date.now().toString(), name });
        document.getElementById('newParentName').value = '';
        saveData();
        renderParentList();
    }
});

function deleteParentModule(id) {
    if (confirm('确定删除此项目模块？其下的核心功能模块将被移除！')) {
        data.parentModules = data.parentModules.filter(pm => pm.id !== id);
        // Remove sub-modules or move them? Let's delete for strict hierarchy
        const subModules = data.modules.filter(m => m.parentId === id);
        const subModuleIds = subModules.map(m => m.id);
        
        data.modules = data.modules.filter(m => m.parentId !== id);
        data.tasks = data.tasks.filter(t => !subModuleIds.includes(t.moduleId));
        
        saveData();
        renderParentList(); // if open
        // render board will happen implicitly or needs call?
        // render() calls are cheap here
        render();
    }
}

function editParentModule(id) {
    const pm = data.parentModules.find(p => p.id === id);
    if (!pm) return;
    
    const newName = prompt("修改项目模块名称：", pm.name);
    if (newName && newName.trim()) {
        pm.name = newName.trim();
        saveData();
        renderParentList(); // Update list if modal is open
    }
}

// Module Modal
function openModuleModal(moduleId) {
    editingModuleId = moduleId;
    const modal = document.getElementById('moduleModal');
    const title = document.getElementById('moduleModalTitle');
    const parentSelect = document.getElementById('moduleParentSelect');
    const nameInput = document.getElementById('moduleName');
    const colorInput = document.getElementById('moduleColor');
    const startInput = document.getElementById('moduleStartDate');
    const endInput = document.getElementById('moduleEndDate');
    const deleteBtn = document.getElementById('deleteModuleBtn');

    // Populate Parent Select
    parentSelect.innerHTML = '';
    data.parentModules.forEach(pm => {
        const opt = document.createElement('option');
        opt.value = pm.id;
        opt.textContent = pm.name;
        parentSelect.appendChild(opt);
    });

    if (moduleId) {
        const module = data.modules.find(m => m.id === moduleId);
        title.textContent = '编辑核心功能模块';
        parentSelect.value = module.parentId || '';
        nameInput.value = module.name;
        colorInput.value = module.color;
        startInput.value = module.startDate || '';
        endInput.value = module.endDate || '';
        deleteBtn.style.display = 'block';
    } else {
        title.textContent = '添加核心功能模块';
        nameInput.value = '';
        colorInput.value = '#5bc17f';
        startInput.value = '';
        endInput.value = '';
        deleteBtn.style.display = 'none';
    }
    
    modal.style.display = 'flex';
}

document.getElementById('addModuleBtn').addEventListener('click', () => {
    if (data.parentModules.length === 0) {
        alert('请先创建至少一个项目模块 (父级)');
        document.getElementById('manageParentsBtn').click();
        return;
    }
    openModuleModal(null);
});

document.getElementById('saveModuleBtn').addEventListener('click', () => {
    const parentId = document.getElementById('moduleParentSelect').value;
    const name = document.getElementById('moduleName').value.trim();
    if (!name) return alert('请输入模块名称');
    
    const color = document.getElementById('moduleColor').value;
    const start = document.getElementById('moduleStartDate').value;
    const end = document.getElementById('moduleEndDate').value;

    if (editingModuleId) {
        const module = data.modules.find(m => m.id === editingModuleId);
        module.parentId = parentId;
        module.name = name;
        module.color = color;
        module.startDate = start;
        module.endDate = end;
    } else {
        data.modules.push({
            id: Date.now().toString(),
            parentId,
            name,
            color,
            startDate: start,
            endDate: end
        });
    }
    
    saveData();
    document.getElementById('moduleModal').style.display = 'none';
});

document.getElementById('deleteModuleBtn').addEventListener('click', () => {
    if (editingModuleId && confirm('确定删除此模块？任务也将被删除！')) {
        data.modules = data.modules.filter(m => m.id !== editingModuleId);
        data.tasks = data.tasks.filter(t => t.moduleId !== editingModuleId);
        saveData();
        document.getElementById('moduleModal').style.display = 'none';
    }
});

// Task Modal
function openTaskModal(taskId, moduleId = null) {
    editingTaskId = taskId;
    const modal = document.getElementById('taskModal');
    const title = document.getElementById('modalTitle');
    const content = document.getElementById('taskContent');
    const moduleSelect = document.getElementById('taskModuleSelect');
    const duration = document.getElementById('taskDuration');
    const start = document.getElementById('taskStartDate');
    const end = document.getElementById('taskEndDate');
    const depSelect = document.getElementById('taskDependencies');
    const deleteBtn = document.getElementById('deleteTaskBtn');

    // Populate Module Select (Grouped by Parent)
    moduleSelect.innerHTML = '<option value="">-- 选择核心功能 --</option>';
    data.parentModules.forEach(pm => {
        const optGroup = document.createElement('optgroup');
        optGroup.label = pm.name;
        
        const subModules = data.modules.filter(m => m.parentId === pm.id);
        subModules.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name;
            optGroup.appendChild(opt);
        });
        
        if (subModules.length > 0) moduleSelect.appendChild(optGroup);
    });

    // Populate Dependencies
    depSelect.innerHTML = '';
    data.tasks.forEach(t => {
        if (t.id !== taskId) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.content.length > 20 ? t.content.slice(0, 20) + '...' : t.content;
            depSelect.appendChild(opt);
        }
    });

    if (taskId) {
        const task = data.tasks.find(t => t.id === taskId);
        title.textContent = '编辑任务';
        content.value = task.content;
        moduleSelect.value = task.moduleId || '';
        duration.value = task.duration || '';
        start.value = task.startDate || '';
        end.value = task.endDate || '';
        
        document.querySelectorAll('input[name="taskStatus"]').forEach(radio => {
            radio.checked = radio.value === task.status;
        });

        if (task.dependencies) {
            Array.from(depSelect.options).forEach(opt => {
                if (task.dependencies.includes(opt.value)) opt.selected = true;
            });
        }
        
        deleteBtn.style.display = 'block';
    } else {
        title.textContent = '新任务';
        content.value = '';
        moduleSelect.value = moduleId || '';
        duration.value = '1';
        start.value = '';
        end.value = '';
        document.querySelector('input[name="taskStatus"][value="pending"]').checked = true;
        deleteBtn.style.display = 'none';
    }

    modal.style.display = 'flex';
}

document.getElementById('saveTaskBtn').addEventListener('click', () => {
    const content = document.getElementById('taskContent').value.trim();
    if (!content) return alert('请输入任务内容');

    const moduleId = document.getElementById('taskModuleSelect').value;
    if (!moduleId) return alert('请选择所属核心功能');

    const duration = document.getElementById('taskDuration').value;
    const startDate = document.getElementById('taskStartDate').value;
    const endDate = document.getElementById('taskEndDate').value;
    const status = document.querySelector('input[name="taskStatus"]:checked').value;
    
    const depSelect = document.getElementById('taskDependencies');
    const dependencies = Array.from(depSelect.selectedOptions).map(opt => opt.value);

    if (editingTaskId) {
        const task = data.tasks.find(t => t.id === editingTaskId);
        task.content = content;
        task.moduleId = moduleId;
        task.duration = duration;
        task.startDate = startDate;
        task.endDate = endDate;
        task.status = status;
        task.dependencies = dependencies;
    } else {
        const newTask = {
            id: Date.now().toString(),
            content,
            moduleId,
            duration,
            startDate,
            endDate,
            status,
            dependencies
        };
        data.tasks.push(newTask);
    }
    
    saveData();
    document.getElementById('taskModal').style.display = 'none';
});

document.getElementById('deleteTaskBtn').addEventListener('click', () => {
    if (editingTaskId && confirm('确定删除此任务？')) {
        data.tasks = data.tasks.filter(t => t.id !== editingTaskId);
        data.tasks.forEach(t => {
            if (t.dependencies) t.dependencies = t.dependencies.filter(d => d !== editingTaskId);
        });
        saveData();
        document.getElementById('taskModal').style.display = 'none';
    }
});

// Export
document.getElementById('exportBtn').addEventListener('click', () => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
});

// Edit Project Name
document.getElementById('editProjectBtn').addEventListener('click', () => {
    const newName = prompt("请输入新的项目名称：", data.project.name);
    if (newName && newName.trim()) {
        data.project.name = newName.trim();
        saveData();
    }
});

// Common Modal Close
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.target.closest('.modal-overlay').style.display = 'none';
    });
});

window.onclick = (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
    }
};

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    
    // Wire up Force Sync Button if connected
    const syncBtn = document.getElementById('forceSyncBtn');
    if (useServer && syncBtn) {
        syncBtn.style.display = 'inline-block';
    } else if (syncBtn) {
        syncBtn.style.display = 'none';
    }
    
    // --- Cloud Config UI Logic ---
    const cloudModal = document.getElementById('cloudConfigModal');
    const cloudBtn = document.getElementById('cloudConfigBtn');
    
    if (cloudBtn && cloudModal) {
        cloudBtn.addEventListener('click', () => {
            // Populate existing config
            if (currentCloudConfig) {
                document.getElementById('cloudServiceType').value = currentCloudConfig.type;
                if (currentCloudConfig.type === 'jsonbin') {
                    document.getElementById('cloudBinId').value = currentCloudConfig.binId;
                    document.getElementById('cloudApiKey').value = currentCloudConfig.apiKey;
                } else {
                    document.getElementById('cloudCustomUrl').value = currentCloudConfig.url;
                }
                document.getElementById('cloudStatusDisplay').textContent = '🟢 已配置: ' + currentCloudConfig.type;
            }
            
            // Toggle inputs based on type
            const toggleInputs = () => {
                const type = document.getElementById('cloudServiceType').value;
                document.getElementById('jsonbinConfig').style.display = type === 'jsonbin' ? 'block' : 'none';
                document.getElementById('customConfig').style.display = type === 'custom' ? 'block' : 'none';
            };
            document.getElementById('cloudServiceType').addEventListener('change', toggleInputs);
            toggleInputs(); // Init
            
            cloudModal.style.display = 'flex';
        });

        document.getElementById('testCloudBtn').addEventListener('click', async () => {
            const type = document.getElementById('cloudServiceType').value;
            let tempConfig = { type };
            
            if (type === 'jsonbin') {
                tempConfig.binId = document.getElementById('cloudBinId').value.trim();
                tempConfig.apiKey = document.getElementById('cloudApiKey').value.trim();
                if (!tempConfig.binId || !tempConfig.apiKey) return alert('请填写完整 JSONBin 信息');
            } else {
                tempConfig.url = document.getElementById('cloudCustomUrl').value.trim();
                if (!tempConfig.url) return alert('请填写 API 地址');
            }

            // Temporarily use this config to test
            const oldConfig = currentCloudConfig;
            currentCloudConfig = tempConfig;
            const data = await fetchFromCloud();
            
            if (data) {
                alert('✅ 连接成功！读取到 ' + (data.tasks ? data.tasks.length : 0) + ' 个任务。');
            }
            currentCloudConfig = oldConfig; // Revert
        });

        document.getElementById('saveCloudBtn').addEventListener('click', async () => {
            const type = document.getElementById('cloudServiceType').value;
            let newConfig = { type };
            
            if (type === 'jsonbin') {
                newConfig.binId = document.getElementById('cloudBinId').value.trim();
                newConfig.apiKey = document.getElementById('cloudApiKey').value.trim();
            } else {
                newConfig.url = document.getElementById('cloudCustomUrl').value.trim();
            }

            currentCloudConfig = newConfig;
            localStorage.setItem('cloud-config', JSON.stringify(newConfig));
            
            // Reload data with new config
            await loadData();
            render();
            
            cloudModal.style.display = 'none';
            alert('已切换到云端模式！');
        });
    }

    render();
});
