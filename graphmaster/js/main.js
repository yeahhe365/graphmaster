/****************************************************
 * main.js
 * GraphMaster core logic.
 * - No confirmation on clear.
 * - Download modal restored (SVG, PNG, PDF).
 * - Graph auto-centers after rendering.
 * - Default Chinese code.
 * - Added Copy Image button.
 * - Added Fullscreen button for preview.
 * - Handles default editor width via state loading.
 ****************************************************/

(() => {
    // Constants
    const LOCAL_STORAGE_KEY = "graphMasterState_v6"; // Version identifier for state
    const RENDER_DEBOUNCE_DELAY = 750;
    const PAN_AMOUNT_KEYBOARD = 50;
    const ZOOM_FACTOR_KEYBOARD = 1.2;
    const COPY_IMAGE_DPI = 300; // DPI for clipboard image
    const DOWNLOAD_IMAGE_DPI = 600; // DPI for downloaded PNG/PDF
    const DEFAULT_EDITOR_FLEX = '0 0 25%'; // Default editor width (1/4)
    const DEFAULT_PREVIEW_FLEX = '1 1 75%'; // Default preview width (3/4)


    // State Variables
    let viz = null, currentSVG = null, editor = null;
    let scale = 1, minScale = 0.05, maxScale = 15, offsetX = 0, offsetY = 0;
    let isDragging = false, isPinching = false, dragStartX = 0, dragStartY = 0;
    let initialPinchDistance = null, initialScale = 1, activePointers = new Map();
    let isResizing = false;
    let autoRenderEnabled = false;
    let renderDebounceTimer = null;
    let isRendering = false;
    let lastTransformUpdateRequest = null;
    let elementFocusedBeforeModal = null; // For restoring focus after modal close

    // DOM Element Cache
    let renderBtn, renderBtnText, clearBtn, pasteBtn, downloadBtn, copyImgBtn, autoRenderCheckbox;
    let downloadModal, closeModalBtn, modalButtons, filenameInput;
    let graphContainer, errorContainer, previewWrapper, resizer, editorContainer, previewContainer, mainContainer;
    let resetViewBtn, zoomInBtn, zoomOutBtn, zoomLevelDisplay;
    let toastContainer;
    let fullscreenBtn; // Fullscreen button element

    // Initialization Function
    function init() {
        cacheDOMElements();
        initializeViz();
        initializeCodeMirror();
        loadAndApplyState(); // Applies saved state OR defaults (including flex widths)
        bindEventListeners();
        setupInitialGraph();
        updateZoomDisplay();
        updateActionButtonsState(); // Initial state for download/copy buttons
        checkFullscreenSupport(); // Check fullscreen API support
        updateFullscreenButtonState(); // Initial state for fullscreen button
        console.log("GraphMaster Initialized (Copy Image, Fullscreen, Default Width)");
    }

    // Cache commonly used DOM elements for performance
    function cacheDOMElements() {
        renderBtn = document.getElementById('render-btn');
        renderBtnText = renderBtn?.querySelector('.btn-text');
        clearBtn = document.getElementById('clear-btn');
        pasteBtn = document.getElementById('paste-btn');
        downloadBtn = document.getElementById('download-btn');
        copyImgBtn = document.getElementById('copy-img-btn');
        autoRenderCheckbox = document.getElementById('auto-render-checkbox');
        downloadModal = document.getElementById('download-modal');
        closeModalBtn = downloadModal?.querySelector('.close-modal');
        modalButtons = downloadModal?.querySelectorAll('.modal-button');
        filenameInput = document.getElementById('filename-input');
        graphContainer = document.getElementById('preview');
        errorContainer = document.getElementById('error');
        previewWrapper = document.getElementById('preview-wrapper');
        resizer = document.getElementById('resizer');
        editorContainer = document.getElementById('editor-container');
        previewContainer = document.getElementById('preview-container'); // Also used for fullscreen target
        mainContainer = document.getElementById('main');
        resetViewBtn = document.getElementById('reset-view-btn');
        zoomInBtn = document.getElementById('zoom-in-btn');
        zoomOutBtn = document.getElementById('zoom-out-btn');
        zoomLevelDisplay = document.getElementById('zoom-level-display');
        toastContainer = document.getElementById('toast-container');
        fullscreenBtn = document.getElementById('fullscreen-btn');

        // Basic check to ensure critical elements exist
        if (!renderBtn || !editorContainer || !previewWrapper || !downloadModal || !downloadBtn || !copyImgBtn || !previewContainer || !fullscreenBtn || !editor) {
             console.error("CRITICAL: Failed to cache essential DOM elements! Functionality may be impaired.");
             // Hide fullscreen button if its container isn't found or supported
             if (fullscreenBtn && (!previewContainer || !document.fullscreenEnabled)) fullscreenBtn.style.display = 'none';
        }
    }

    // Initialize the Viz.js rendering engine
    function initializeViz() {
        try {
            viz = new Viz();
        } catch (err) {
            console.error("Failed to initialize Viz.js:", err);
            showToast("图形引擎加载失败", "error", 5000);
            if(renderBtn) renderBtn.disabled = true;
            if(autoRenderCheckbox) autoRenderCheckbox.disabled = true;
        }
    }

    // Initialize the CodeMirror editor
    function initializeCodeMirror() {
        const dotInputElement = document.getElementById("dot-input");
        if (!dotInputElement) {
            console.error("CodeMirror textarea element (#dot-input) not found!");
            return;
        }
        try {
            editor = CodeMirror.fromTextArea(dotInputElement, {
                lineNumbers: true,
                lineWrapping: false, // Keep wrapping off by default
                mode: "javascript", // Using JS mode for DOT highlighting (works okay)
                theme: "default",
                gutters: ["CodeMirror-lint-markers"],
                lint: false, // No specific DOT linter configured
            });
        } catch (err) {
            console.error("Failed to initialize CodeMirror:", err);
            showToast("编辑器加载失败", "error", 5000);
        }
    }

    // Load state from localStorage or set defaults
    function loadAndApplyState() {
        const defaultDot = `// 定义一个有向图 (digraph)，名为 "WorkflowExample"
digraph WorkflowExample {

    // --- 全局设置 ---
    graph [ fontname="Microsoft YaHei", fontsize=12, label="一个简单的工作流程示例", labelloc="t", rankdir="LR" ];
    node [ fontname="Microsoft YaHei", fontsize=10, shape=box, style=filled, fillcolor="lightblue", margin="0.1,0.1" ];
    edge [ fontname="Microsoft YaHei", fontsize=9, color="darkslategray" ];

    // --- 节点定义 ---
    Start [label="开始", shape=ellipse, fillcolor="palegreen"];
    Process1 [label="步骤 1:\\n数据准备"];
    Process2 [label="步骤 2:\\n核心处理"];
    Decision [label="条件判断:\\n是否成功?", shape=diamond, fillcolor="lightyellow"];
    End_Success [label="结束 (成功)", shape=ellipse, fillcolor="palegreen"];
    End_Fail [label="结束 (失败)", shape=ellipse, fillcolor="lightcoral"];

    // --- 边定义 ---
    Start -> Process1 -> Process2 -> Decision;
    Decision -> End_Success [label="是"];
    Decision -> End_Fail    [label="否", style=dashed, color=red];

    // --- 子图 ---
    subgraph cluster_Processing {
        label = "处理阶段"; bgcolor = "lightgrey"; style = "filled";
        Process1; Process2; Decision; // Nodes within subgraph
    }
}`;
        const savedState = loadState(); // Load potentially saved state

        if (editor) { // Ensure editor is initialized
            editor.setValue(savedState?.dot || defaultDot);
        } else {
            console.warn("Editor not ready during state loading.");
        }

        autoRenderEnabled = !!savedState?.autoRenderEnabled;
        if(autoRenderCheckbox) autoRenderCheckbox.checked = autoRenderEnabled;

        // Apply saved transform or defaults
        scale = typeof savedState?.scale === "number" ? savedState.scale : 1;
        offsetX = typeof savedState?.offsetX === "number" ? savedState.offsetX : 0;
        offsetY = typeof savedState?.offsetY === "number" ? savedState.offsetY : 0;

        // Apply saved flex layout or defaults
        const editorFlex = savedState?.editorFlex || DEFAULT_EDITOR_FLEX;
        const previewFlex = savedState?.previewFlex || DEFAULT_PREVIEW_FLEX;
        if (editorContainer) editorContainer.style.flex = editorFlex;
        if (previewContainer) previewContainer.style.flex = previewFlex;

        // If loading defaults, reset transform as well
        if (!savedState) {
            resetTransform(false); // Reset without saving immediately
        }
    }

    // Render the initial graph if DOT code exists on load
    function setupInitialGraph() {
        if (editor && editor.getValue().trim() && viz) {
            renderGraph(false) // Render without fitting immediately
                .then(() => {
                    // Fit *after* initial render completes and layout is stable
                    requestAnimationFrame(() => fitGraphToView(false));
                })
                .catch(err => console.error("Initial render failed:", err));
        } else {
             requestTransformUpdate(); // Apply loaded/default transform
             updateZoomDisplay();
             updateActionButtonsState(); // Set initial button states
        }
    }

    // Bind all necessary event listeners
    function bindEventListeners() {
        if (editor) editor.on("change", handleEditorChange);

        // Header buttons
        if (renderBtn) renderBtn.addEventListener('click', () => { if (!isRendering) renderGraph(true); });
        if (clearBtn) clearBtn.addEventListener('click', clearAll);
        if (pasteBtn) pasteBtn.addEventListener('click', pasteFromClipboard);
        if (copyImgBtn) copyImgBtn.addEventListener('click', copyImageToClipboard);
        if (downloadBtn) downloadBtn.addEventListener('click', openDownloadModal);
        if (autoRenderCheckbox) autoRenderCheckbox.addEventListener('change', toggleAutoRender);

        // Download Modal
        if (closeModalBtn) closeModalBtn.addEventListener('click', closeDownloadModal);
        if (downloadModal) {
             downloadModal.addEventListener('click', (e) => { if (e.target === downloadModal) closeDownloadModal(); });
             modalButtons.forEach(button => button.addEventListener('click', handleDownloadFormatSelection));
             downloadModal.addEventListener('keydown', handleModalKeyDown); // For focus trap
        }

        // Preview area interactions
        if (previewWrapper) {
             previewWrapper.addEventListener('pointerdown', previewPointerDown);
             previewWrapper.addEventListener('pointermove', previewPointerMove);
             previewWrapper.addEventListener('pointerup', previewPointerUp);
             previewWrapper.addEventListener('pointercancel', previewPointerUp); // Handle cancellations
             previewWrapper.addEventListener('wheel', previewWheelHandler, { passive: false }); // Prevent default scroll
             previewWrapper.addEventListener('dblclick', () => fitGraphToView(true)); // Fit on double-click
             previewWrapper.addEventListener('keydown', handlePreviewKeyDown); // Keyboard nav/zoom
        }

        // View controls
        if (resetViewBtn) resetViewBtn.addEventListener('click', () => fitGraphToView(true));
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => zoomWithFeedback(ZOOM_FACTOR_KEYBOARD));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomWithFeedback(1 / ZOOM_FACTOR_KEYBOARD));

        // Panel Resizer
        if (resizer) {
             resizer.addEventListener('pointerdown', resizerPointerDown);
             // Listen on window for move/up to handle dragging outside the resizer element
             window.addEventListener('pointermove', resizerPointerMove);
             window.addEventListener('pointerup', resizerPointerUp);
        }

        // Fullscreen button and events
        if (fullscreenBtn) fullscreenBtn.addEventListener('click', togglePreviewFullscreen);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        document.addEventListener('MSFullscreenChange', handleFullscreenChange);

        // Global listeners
        window.addEventListener('keydown', handleGlobalKeyDown);
        window.addEventListener('beforeunload', saveState); // Save state before leaving
    }

    // --- State Saving/Loading ---
    function saveState() {
        if (!editor || !editorContainer || !previewContainer) return; // Ensure elements exist
        const state = {
            dot: editor.getValue(),
            autoRenderEnabled: autoRenderEnabled,
            scale: scale,
            offsetX: offsetX,
            offsetY: offsetY,
            editorFlex: editorContainer.style.flex || null, // Save current flex basis
            previewFlex: previewContainer.style.flex || null,
        };
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error("保存状态失败: ", e);
            showToast("无法保存当前状态", "warning");
        }
    }

    function loadState() {
        try {
            const stateStr = localStorage.getItem(LOCAL_STORAGE_KEY);
            return stateStr ? JSON.parse(stateStr) : null;
        } catch (e) {
            console.error("加载状态失败: ", e);
            localStorage.removeItem(LOCAL_STORAGE_KEY); // Clear corrupted state
            showToast("无法加载状态,已重置", "warning");
            return null;
        }
    }
    // --- End State ---

    // --- Editor and Rendering ---
    function handleEditorChange() {
        clearTimeout(renderDebounceTimer); // Reset debounce timer
        saveState(); // Save changes frequently
        if (autoRenderEnabled && !isRendering && viz) {
            renderDebounceTimer = setTimeout(() => {
                renderGraph(true); // Trigger auto-render with fit/center
            }, RENDER_DEBOUNCE_DELAY);
        }
    }

    function toggleAutoRender(e) {
        autoRenderEnabled = e.target.checked;
        saveState();
        // If enabled and code exists, render immediately
        if (autoRenderEnabled && editor && editor.getValue().trim() && !isRendering && viz) {
            renderGraph(true);
        }
    }

    async function renderGraph(fitViewAfterRender = false) {
        if (isRendering) return Promise.reject("Already rendering");
        if (!viz || !editor) return Promise.reject("Viz.js or Editor not initialized");

        const dot = editor.getValue();
        clearError(); // Clear previous errors
        updateActionButtonsState(); // Disable buttons during render prep

        // Handle empty input
        if (!dot.trim()) {
            if(graphContainer) graphContainer.innerHTML = ''; // Clear preview
            currentSVG = null;
            resetTransform(true); // Reset view
            updateActionButtonsState(); // Re-enable buttons if needed
            return Promise.resolve(); // Success (cleared)
        }

        setRenderingState(true); // Enter rendering state

        try {
            const element = await viz.renderSVGElement(dot); // The core rendering call
            if(graphContainer) {
                graphContainer.innerHTML = ''; // Clear previous SVG
                graphContainer.appendChild(element); // Add the new SVG
            }
            currentSVG = element; // Store reference to the current SVG

            if (fitViewAfterRender) {
                fitGraphToView(false); // Fit silently after render completes
            } else {
                requestTransformUpdate(); // Apply existing transform if not fitting
            }
            saveState(); // Save the new DOT code and potentially transform
            setRenderingState(false); // Exit rendering state
            return Promise.resolve(); // Success

        } catch (error) {
            console.error("Viz.js Render Error:", error);
            displayRenderError(error); // Show error message
            if(graphContainer) graphContainer.innerHTML = ''; // Clear preview on error
            currentSVG = null;
            resetTransform(true); // Reset view on error
            setRenderingState(false); // Exit rendering state (important!)
            return Promise.reject(error); // Propagate the error

        } finally {
             updateActionButtonsState(); // Ensure button states are correct after render attempt
        }
    }

    // Update UI to reflect rendering state
    function setRenderingState(rendering) {
        isRendering = rendering;
        if (renderBtn) {
            renderBtn.disabled = rendering;
            const icon = renderBtn.querySelector('i');
            const textSpan = renderBtn.querySelector('.btn-text');
            if(rendering) {
                if (textSpan) textSpan.textContent = '渲染中...';
                renderBtn.classList.add('loading');
                if (icon) icon.className = 'fas fa-spinner fa-spin'; // Spinner icon
            } else {
                if (textSpan) textSpan.textContent = '渲染';
                renderBtn.classList.remove('loading');
                if (icon) icon.className = 'fas fa-play'; // Play icon
            }
        }
        // Also update dependent buttons
        updateActionButtonsState();
    }

    // Display rendering errors to the user
    function displayRenderError(error) {
        let errorMessage = '渲染错误: ';
        errorMessage += (error instanceof Error) ? error.message : String(error);
        // Provide hints for common errors
        if (typeof error === 'string' && error.includes('syntax error')) {
             errorMessage += "\n请检查 DOT 代码语法。";
        }
        if (errorContainer) errorContainer.textContent = errorMessage;
    }

    function clearError() {
        if (errorContainer) errorContainer.textContent = '';
    }

    // Clear editor, preview, and reset state
    function clearAll() {
        if(editor) editor.setValue(''); // Clear editor content
        if(graphContainer) graphContainer.innerHTML = ''; // Clear preview display
        clearError(); // Clear any error messages
        currentSVG = null; // Remove SVG reference
        resetTransform(false); // Reset view transform without saving yet
        requestTransformUpdate(); // Apply reset transform
        saveState(); // Save the cleared state
        updateActionButtonsState(); // Update button states
        showToast("已清空", "info");
    }
    // --- End Editor and Rendering ---

    // --- View Transformation and Manipulation ---
    function resetTransform(save = true) {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        requestTransformUpdate();
        updateZoomDisplay();
        if (save) saveState(); // Save reset state if requested
    }

    // Fit the graph nicely within the preview wrapper bounds
    function fitGraphToView(showFeedback = false) {
        if (!currentSVG || !previewWrapper) {
            resetTransform(true); // Reset if no SVG or wrapper
            return;
        }
        // Use requestAnimationFrame to ensure layout is calculated
        requestAnimationFrame(() => {
            const bbox = getValidBBox(currentSVG);
            if (!bbox) {
                console.warn("Cannot fit view: Invalid SVG BBox.");
                resetTransform(true); // Reset if BBox is invalid
                return;
            }

            const containerWidth = previewWrapper.clientWidth;
            const containerHeight = previewWrapper.clientHeight;
            const padding = 20; // Add some padding around the graph
            const availableWidth = Math.max(containerWidth - 2 * padding, 1); // Avoid division by zero
            const availableHeight = Math.max(containerHeight - 2 * padding, 1);

            // Calculate scale to fit both width and height
            const scaleX = availableWidth / bbox.width;
            const scaleY = availableHeight / bbox.height;
            const newScale = Math.min(scaleX, scaleY); // Use the smaller scale factor

            // Clamp scale within min/max limits
            scale = Math.max(minScale, Math.min(maxScale, newScale));

            // Calculate offset to center the scaled graph
            offsetX = (containerWidth - bbox.width * scale) / 2 - bbox.x * scale;
            offsetY = (containerHeight - bbox.height * scale) / 2 - bbox.y * scale;

            requestTransformUpdate(); // Apply new transform
            updateZoomDisplay(); // Update UI display
            saveState(); // Save the fitted state

            // Optional visual feedback
            if (showFeedback && previewWrapper) {
                previewWrapper.classList.add('is-fitting');
                // Remove class after animation
                setTimeout(() => previewWrapper.classList.remove('is-fitting'), 300);
            }
        });
    }

    // Get the bounding box of the SVG, with fallbacks
    function getValidBBox(svgElement) {
        try {
            if (!svgElement || !svgElement.getBBox) return null; // Basic check
            const bbox = svgElement.getBBox();

            // Primary check: Valid, finite, positive dimensions from getBBox
            if (bbox && isFinite(bbox.x) && isFinite(bbox.y) && isFinite(bbox.width) && isFinite(bbox.height) && bbox.width > 0 && bbox.height > 0) {
                return bbox;
            }

            // Fallback 1: Use viewBox attribute if getBBox failed or returned zero size
            const viewBox = svgElement.viewBox?.baseVal;
            if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
                console.warn("Using viewBox as BBox fallback.");
                return { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height };
            }

            // Fallback 2: Use width/height attributes if viewBox also failed
             const widthAttr = parseFloat(svgElement.getAttribute('width'));
             const heightAttr = parseFloat(svgElement.getAttribute('height'));
             if (widthAttr > 0 && heightAttr > 0) {
                 console.warn("Using width/height attributes as BBox fallback.");
                 // Assume origin 0,0 if only attributes are available and getBBox failed
                 return { x: 0, y: 0, width: widthAttr, height: heightAttr };
             }

            console.warn("Could not determine valid BBox for SVG element.");
            return null; // Return null if no valid dimensions found

        } catch (e) {
            console.error("Error getting SVG BBox:", e);
            return null;
        }
    }


    // Zoom centered on a specific point (mouse cursor or center)
    function zoom(factor, clientX, clientY) {
        const newScale = Math.min(Math.max(scale * factor, minScale), maxScale);
        if (newScale === scale) return; // No change

        const previewRect = previewWrapper.getBoundingClientRect();
        // Calculate zoom origin: Use provided coords or center of wrapper
        const originX = clientX !== undefined ? clientX - previewRect.left : previewWrapper.clientWidth / 2;
        const originY = clientY !== undefined ? clientY - previewRect.top : previewWrapper.clientHeight / 2;

        // Calculate the point in graph coordinates corresponding to the origin
        const graphX = (originX - offsetX) / scale;
        const graphY = (originY - offsetY) / scale;

        // Calculate the new offset to keep the origin point stationary
        offsetX = originX - graphX * newScale;
        offsetY = originY - graphY * newScale;
        scale = newScale; // Update scale

        requestTransformUpdate();
        updateZoomDisplay();
    }

    // Apply zoom and save state afterwards
    function zoomWithFeedback(factor, clientX, clientY) {
        const oldScale = scale;
        zoom(factor, clientX, clientY); // Apply the zoom
        if (scale !== oldScale) saveState(); // Save if scale actually changed
    }

    // Pan the view by a delta amount
    function pan(deltaX, deltaY) {
        offsetX += deltaX;
        offsetY += deltaY;
        requestTransformUpdate();
        saveState(); // Save new position
    }

    // Update the zoom level display percentage
    function updateZoomDisplay() {
        if (zoomLevelDisplay) zoomLevelDisplay.textContent = `${Math.round(scale * 100)}%`;
    }

    // Request an animation frame to update the SVG transform (debounces multiple updates)
    function requestTransformUpdate() {
        if (lastTransformUpdateRequest !== null) return; // Already requested
        lastTransformUpdateRequest = requestAnimationFrame(() => {
            updateTransform();
            lastTransformUpdateRequest = null; // Clear request ID
        });
    }

    // Apply the current transform (scale, offset) to the SVG container
    function updateTransform() {
        if (graphContainer) {
            // Using translate3d for potential hardware acceleration
            graphContainer.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
        }
    }
    // --- End View Transformation ---

    // --- Pointer Interactions (Dragging, Pinching) ---
    function previewPointerDown(e) {
        // Ignore right-clicks from mouse
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (!previewWrapper) return;

        previewWrapper.focus(); // Focus for keyboard events
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); // Track pointer
        previewWrapper.classList.add('is-interacting'); // Visual feedback
        e.target.setPointerCapture(e.pointerId); // Capture pointer events to this element

        if (activePointers.size === 1) { // Start dragging
            isDragging = true;
            isPinching = false;
            // Calculate initial drag offset relative to current view offset
            dragStartX = e.clientX - offsetX;
            dragStartY = e.clientY - offsetY;
            previewWrapper.style.cursor = 'grabbing'; // Change cursor
        } else if (activePointers.size === 2) { // Start pinching
            isDragging = false;
            isPinching = true;
            previewWrapper.style.cursor = 'default'; // Use default cursor during pinch
            const points = Array.from(activePointers.values());
            initialPinchDistance = getDistance(points[0], points[1]); // Store initial distance
            initialScale = scale; // Store scale at pinch start
        }
    }

    function previewPointerMove(e) {
        if (!activePointers.has(e.pointerId) || !previewWrapper) return; // Only track active pointers

        // Update pointer position
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (isDragging && !isPinching && activePointers.size === 1) { // Handle dragging
            offsetX = e.clientX - dragStartX;
            offsetY = e.clientY - dragStartY;
            requestTransformUpdate(); // Update view smoothly
        } else if (isPinching && activePointers.size >= 2) { // Handle pinching
            const points = Array.from(activePointers.values());
            const currentDistance = getDistance(points[0], points[1]);
            if (initialPinchDistance > 0) { // Avoid division by zero
                const pinchScaleFactor = currentDistance / initialPinchDistance;
                const targetScale = initialScale * pinchScaleFactor;

                // Calculate pinch center relative to the preview wrapper
                const previewRect = previewWrapper.getBoundingClientRect();
                const pinchCenterX = (points[0].x + points[1].x) / 2 - previewRect.left;
                const pinchCenterY = (points[0].y + points[1].y) / 2 - previewRect.top;

                // Zoom relative to the pinch center
                zoom(targetScale / scale, pinchCenterX, pinchCenterY);
                // No need to update initialPinchDistance/initialScale here, zoom handles it
            }
        }
    }

    function previewPointerUp(e) {
        if (activePointers.has(e.pointerId)) {
             e.target.releasePointerCapture(e.pointerId); // Release pointer capture
             activePointers.delete(e.pointerId); // Remove pointer from tracking
         }

        // Update interaction states based on remaining pointers
        if (activePointers.size < 2) isPinching = false;
        if (activePointers.size < 1) isDragging = false;

        // If one pointer remains, transition back to dragging state
        if (activePointers.size === 1) {
             isDragging = true;
             const remainingPointer = Array.from(activePointers.values())[0];
             dragStartX = remainingPointer.x - offsetX;
             dragStartY = remainingPointer.y - offsetY;
             if (previewWrapper) previewWrapper.style.cursor = 'grabbing';
        }

        // If all pointers are up, reset cursor and save state
        if (!isDragging && !isPinching) {
            if (previewWrapper) {
                previewWrapper.classList.remove('is-interacting');
                previewWrapper.style.cursor = 'grab'; // Reset cursor
            }
            saveState(); // Save final transform state
        }
    }

    // Handle mouse wheel / trackpad pinch zoom
    function previewWheelHandler(e) {
        e.preventDefault(); // Prevent page scrolling
        const deltaFactor = e.deltaY < 0 ? ZOOM_FACTOR_KEYBOARD : 1 / ZOOM_FACTOR_KEYBOARD;
        zoomWithFeedback(deltaFactor, e.clientX, e.clientY); // Zoom centered on cursor
    }

    // Calculate distance between two points
    function getDistance(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Handle keyboard navigation (arrows for pan, +/- for zoom) when preview has focus
    function handlePreviewKeyDown(e) {
        let panX = 0, panY = 0;
        let zoomFactor = 1;
        let handled = true; // Assume we handle the key

        switch (e.key) {
            case 'ArrowUp': panY = PAN_AMOUNT_KEYBOARD; break;
            case 'ArrowDown': panY = -PAN_AMOUNT_KEYBOARD; break;
            case 'ArrowLeft': panX = PAN_AMOUNT_KEYBOARD; break;
            case 'ArrowRight': panX = -PAN_AMOUNT_KEYBOARD; break;
            case '+': case '=': zoomFactor = ZOOM_FACTOR_KEYBOARD; break; // Zoom in
            case '-': case '_': zoomFactor = 1 / ZOOM_FACTOR_KEYBOARD; break; // Zoom out
            default: handled = false; break; // Let other keys pass through
        }

        if (handled) {
            e.preventDefault(); // Stop browser default action (scrolling, etc.)
            if (panX !== 0 || panY !== 0) pan(panX, panY); // Apply pan if needed
            if (zoomFactor !== 1) zoomWithFeedback(zoomFactor); // Apply zoom if needed
        }
    }
    // --- End Pointer Interactions ---

    // --- Panel Resizing ---
    function resizerPointerDown(e) {
        if (e.button !== 0 || !resizer) return; // Only handle left mouse button
        isResizing = true;
        // Change cursor globally during resize
        document.body.style.cursor = window.innerWidth > 800 ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none'; // Prevent text selection
        resizer.setPointerCapture(e.pointerId); // Capture pointer
    }

    function resizerPointerMove(e) {
        if (!isResizing || !mainContainer || !editorContainer || !previewContainer) return;

        const rect = mainContainer.getBoundingClientRect();
        let percentage;
        // Determine resize direction based on layout (horizontal or vertical)
        if (window.innerWidth > 800) { // Horizontal layout (wider screens)
            const pointerX = e.clientX - rect.left;
            percentage = Math.max(10, Math.min(90, (pointerX / rect.width) * 100)); // Clamp 10%-90%
        } else { // Vertical layout (narrower screens)
            const pointerY = e.clientY - rect.top;
            percentage = Math.max(10, Math.min(90, (pointerY / rect.height) * 100)); // Clamp 10%-90%
        }

        // Update flex basis for both panels
        editorContainer.style.flex = `0 0 ${percentage}%`;
        previewContainer.style.flex = `1 1 ${100 - percentage}%`; // Preview takes remaining space
    }

    function resizerPointerUp(e) {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default'; // Reset global cursor
            document.body.style.userSelect = ''; // Re-enable text selection
            if (resizer) resizer.releasePointerCapture(e.pointerId); // Release pointer
            saveState(); // Save the new panel sizes
        }
    }
    // --- End Panel Resizing ---

    // --- Global Key Handler ---
    function handleGlobalKeyDown(e) {
        // Ctrl/Cmd + Enter to Render
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!isRendering && viz) renderGraph(true); // Trigger render + fit
        }

        // Escape key handling
        if (e.key === 'Escape') {
             // Close modal if open
             if (downloadModal && downloadModal.style.display === 'flex') {
                 closeDownloadModal();
             }
             // Exit fullscreen if active (browser handles this, but update state via event)
             else if (isFullscreenActive()) {
                 exitFullscreen(); // Attempt graceful exit
             }
         }
        // Optional: 'f' key to toggle fullscreen
        // if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        //     // Ensure focus isn't in an input field like the editor
        //     if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        //        e.preventDefault();
        //        togglePreviewFullscreen();
        //     }
        // }
    }
    // --- End Global Key Handler ---

    // --- Download, Copy, and Related Utils ---
    // Update enable/disable state of Download and Copy buttons
    function updateActionButtonsState() {
        const isDisabled = !currentSVG || isRendering; // Disable if no SVG or rendering
        if (downloadBtn) downloadBtn.disabled = isDisabled;
        if (copyImgBtn) copyImgBtn.disabled = isDisabled;
        // Fullscreen button state is handled separately based on API support/state
    }

    // Show the download modal
    function openDownloadModal(e) {
        if (!downloadBtn || downloadBtn.disabled) return; // Don't open if disabled
        e.stopPropagation(); // Prevent triggering other listeners

        if (filenameInput) filenameInput.value = 'graph'; // Reset filename
        elementFocusedBeforeModal = document.activeElement; // Store focus
        if (downloadModal) downloadModal.style.display = 'flex'; // Show modal

        // Focus the first focusable element in the modal for accessibility
        const firstFocusable = filenameInput || downloadModal?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if(firstFocusable) setTimeout(() => firstFocusable.focus(), 50); // Delay focus until visible
    }

    // Hide the download modal
    function closeDownloadModal() {
        if(downloadModal) downloadModal.style.display = 'none'; // Hide modal
        // Restore focus to the previously focused element
        if (elementFocusedBeforeModal) {
             setTimeout(() => {
                try { elementFocusedBeforeModal.focus(); } catch(e) {} // Try to restore focus
                elementFocusedBeforeModal = null; // Clear stored element
            }, 0); // Timeout helps ensure display change is processed first
        }
    }

    // Handle click on a format button in the download modal
    function handleDownloadFormatSelection() {
        const format = this.getAttribute('data-format');
        if (format) {
            downloadGraph(format); // Initiate download
            closeDownloadModal(); // Close modal after selection
        }
    }

    // Trap focus within the download modal using Tab/Shift+Tab
    function handleModalKeyDown(e) {
        if (e.key === 'Tab') trapFocusInModal(e);
    }

    function trapFocusInModal(e) {
         if (!downloadModal) return;
         // Find all visible, focusable elements
         const focusableElements = Array.from(
             downloadModal.querySelectorAll('button, [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')
         ).filter(el => el.offsetParent !== null); // Check visibility

         if (focusableElements.length === 0) return;

         const firstElement = focusableElements[0];
         const lastElement = focusableElements[focusableElements.length - 1];

         if (e.shiftKey) { // Shift + Tab (move backwards)
             if (document.activeElement === firstElement) {
                 lastElement.focus(); // Wrap to end
                 e.preventDefault();
             }
         } else { // Tab (move forwards)
             if (document.activeElement === lastElement) {
                 firstElement.focus(); // Wrap to start
                 e.preventDefault();
             }
         }
     }

    // Copy the current graph image to the clipboard as PNG
    async function copyImageToClipboard() {
        if (!currentSVG || copyImgBtn?.disabled) {
            showToast('请先渲染图形', 'warning');
            return;
        }

        // Check for modern Clipboard API support
        if (!navigator.clipboard || !navigator.clipboard.write) {
            showToast('浏览器不支持写入剪贴板 API', 'error', 5000);
            console.error('Clipboard API (write) not supported.');
            return;
        }
        // Check specifically for ClipboardItem support (required for Blobs)
        if (typeof ClipboardItem === "undefined") {
             showToast('浏览器不支持复制图像 (ClipboardItem)', 'error', 5000);
             console.error('ClipboardItem API not supported.');
             return;
        }

        showToast('正在复制图像...', 'info', 1500);

        try {
            // 1. Render SVG to an offscreen canvas at desired DPI
            const canvas = await svgToCanvas(currentSVG, COPY_IMAGE_DPI);

            // 2. Get PNG Blob data from the canvas
            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法从 Canvas 创建 Blob')), 'image/png');
            });

            // 3. Create a ClipboardItem and write to the clipboard
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob }) // Standard PNG MIME type
            ]);

            showToast('图像已复制到剪贴板!', 'success', 3000);

        } catch (error) {
            console.error('复制图像失败:', error);
            let errorMsg = error.message || '未知错误';
            // Provide more specific user feedback based on error type
            if (error.name === 'NotAllowedError') errorMsg = '需要剪贴板写入权限';
            else if (error.message.includes('secure context')) errorMsg = '剪贴板操作需要安全连接(HTTPS)';
            else if (error.message.includes('Blob')) errorMsg = '无法创建图像数据';
            showToast(`复制失败: ${errorMsg}`, 'error', 5000);
        }
    }

    // Download the current graph in the selected format (SVG, PNG, PDF)
    async function downloadGraph(format) {
        if (!currentSVG || downloadBtn?.disabled) {
            showToast('请先渲染图形再下载', "warning");
            return;
        }

        // Get and sanitize filename
        const filenameBase = filenameInput?.value.trim().replace(/[\\/:*?"<>|]/g, '_') || 'graph';
        const filename = `${filenameBase}.${format}`;

        showToast(`正在准备 ${format.toUpperCase()}...`, "info", 2000);

        try {
            if (format === 'svg') {
                // Serialize SVG, ensuring XML declaration and namespace
                const serializer = new XMLSerializer();
                let svgData = serializer.serializeToString(currentSVG);
                // Add XML declaration if missing
                if (!svgData.match(/^<\?xml/)) {
                    svgData = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + svgData;
                }
                // Add xmlns attribute if missing
                 if (!svgData.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
                     if (svgData.includes('<svg')) { // Find the svg tag
                         svgData = svgData.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
                     }
                 }
                const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
                saveAs(blob, filename); // Use FileSaver.js

            } else if (format === 'png') {
                // Render to canvas at high DPI for download
                const canvas = await svgToCanvas(currentSVG, DOWNLOAD_IMAGE_DPI);
                const blob = await new Promise((resolve, reject) => {
                    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas toBlob failed")), 'image/png');
                });
                saveAs(blob, filename);

            } else if (format === 'pdf') {
                // Render to canvas, then embed PNG data into PDF
                const canvas = await svgToCanvas(currentSVG, DOWNLOAD_IMAGE_DPI);
                const imgData = canvas.toDataURL('image/png');
                const { jsPDF } = window.jspdf; // Get jsPDF constructor
                if (!jsPDF) throw new Error("jsPDF library not loaded.");

                // Create PDF matching canvas dimensions precisely
                const pdf = new jsPDF({
                    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
                    unit: 'pt', // Use points for units matching canvas pixels
                    format: [canvas.width, canvas.height] // Custom format based on canvas size
                });
                pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
                pdf.save(filename); // Trigger download
            }
            // Delay success message slightly to allow download initiation
            setTimeout(() => showToast(`下载已开始: ${filename}`, "success", 4000), 500);

        } catch (error) {
            console.error(`Download failed for ${format}:`, error);
            showToast(`下载 ${format.toUpperCase()} 失败: ${error.message}`, "error", 5000);
        }
    }

    // Convert an SVG element to a Canvas element at a specified DPI
    function svgToCanvas(svgElement, dpi = 300) {
         return new Promise((resolve, reject) => {
            const serializer = new XMLSerializer();
            let svgData;
            try {
                svgData = serializer.serializeToString(svgElement);
            } catch (error) {
                return reject(new Error("Failed to serialize SVG: " + error.message));
            }

            // Basic check for valid SVG data
            if (!svgData || svgData.length < 10) {
                 return reject(new Error("Invalid or empty SVG data for canvas conversion."));
            }

            // Add xmlns if missing (crucial for rendering in Image/Canvas)
            if (!svgData.match(/xmlns=/)) {
                 svgData = svgData.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
            }

            const img = new Image();
            const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
            const url = URL.createObjectURL(svgBlob); // Create temporary URL

            img.onload = () => {
                const bbox = getValidBBox(svgElement); // Get dimensions
                if (!bbox) {
                    URL.revokeObjectURL(url); // Clean up URL
                    return reject(new Error("无法确定有效的 SVG 尺寸以导出到画布。"));
                }
                 const svgWidth = bbox.width;
                 const svgHeight = bbox.height;
                 const svgX = bbox.x;
                 const svgY = bbox.y;

                if (svgWidth <= 0 || svgHeight <= 0) {
                     URL.revokeObjectURL(url);
                     return reject(new Error(`无效的 SVG 尺寸: W=${svgWidth}, H=${svgHeight}`));
                 }

                const canvas = document.createElement('canvas');
                const scaleFactor = Math.max(0.1, dpi / 96); // Standard DPI baseline is 96
                // Calculate canvas size based on SVG dimensions and DPI scale
                canvas.width = Math.ceil(svgWidth * scaleFactor);
                canvas.height = Math.ceil(svgHeight * scaleFactor);
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    URL.revokeObjectURL(url);
                    return reject(new Error("无法获取画布 2D 上下文。"));
                }

                // Optional: Fill background (important for formats like PNG/JPEG if SVG is transparent)
                ctx.fillStyle = "#ffffff"; // White background
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Scale the canvas context to draw the image at high resolution
                ctx.scale(scaleFactor, scaleFactor);

                // Draw the SVG image onto the canvas, adjusting for the bounding box origin
                // This ensures only the relevant part of the SVG is drawn
                ctx.drawImage(img, -svgX, -svgY, svgWidth, svgHeight);

                URL.revokeObjectURL(url); // Clean up Blob URL
                resolve(canvas); // Return the populated canvas
            };

            img.onerror = (err) => {
                URL.revokeObjectURL(url); // Clean up Blob URL
                console.error("Image loading failed for canvas export:", err, svgData.substring(0, 500)); // Log error and part of SVG data
                reject(new Error("无法加载 SVG 图像以进行导出"));
            };

            img.src = url; // Start loading the SVG data into the Image object
        });
    }
    // --- End Download & Copy ---


    // ========== FULLSCREEN API LOGIC ==========

    function isFullscreenActive() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    }

    function getFullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    }

     function checkFullscreenSupport() {
         const enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled || document.mozFullScreenEnabled || document.msFullscreenEnabled;
         if (!enabled && fullscreenBtn) {
             console.warn("Fullscreen API is not supported or enabled by this browser.");
             fullscreenBtn.style.display = 'none'; // Hide button if unsupported
         } else if (fullscreenBtn) {
             fullscreenBtn.style.display = 'flex'; // Ensure visible if supported
         }
     }

    function requestFullscreen(element) {
        // Use standard or prefixed methods
        if (element.requestFullscreen) element.requestFullscreen();
        else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
        else if (element.mozRequestFullScreen) element.mozRequestFullScreen();
        else if (element.msRequestFullscreen) element.msRequestFullscreen();
        else {
            showToast("无法进入全屏模式", "error");
            console.error("Fullscreen request method not found.");
        }
    }

    function exitFullscreen() {
        // Use standard or prefixed methods
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
        // No error toast here as ESC key handles exit silently
    }

    // Toggle fullscreen for the preview container
    function togglePreviewFullscreen() {
        if (!previewContainer || !fullscreenBtn) return; // Ensure elements exist

        if (!isFullscreenActive()) {
            requestFullscreen(previewContainer); // Enter fullscreen
        } else {
            // Only exit if *our* container is the one currently fullscreen
            if (getFullscreenElement() === previewContainer) {
                exitFullscreen(); // Exit fullscreen
            } else {
                console.warn("Attempting to exit fullscreen, but a different element is active.");
                // Optionally force exit: exitFullscreen();
            }
        }
    }

    // Update fullscreen button icon/title and body class
    function updateFullscreenButtonState() {
        if (!fullscreenBtn) return;
        const icon = fullscreenBtn.querySelector('i');
        if (!icon) return;

        // Check if *our* preview container is the active fullscreen element
        if (isFullscreenActive() && getFullscreenElement() === previewContainer) {
            icon.className = 'fas fa-compress'; // Shrink icon
            fullscreenBtn.title = '退出全屏 (Exit Fullscreen)';
            document.body.classList.add('preview-fullscreen'); // Add class for CSS styling
        } else {
            icon.className = 'fas fa-expand'; // Expand icon
            fullscreenBtn.title = '全屏 (Fullscreen)';
            document.body.classList.remove('preview-fullscreen'); // Remove class
        }
    }

    // Handler for fullscreen change events (inc. ESC key)
    function handleFullscreenChange() {
        updateFullscreenButtonState(); // Update UI based on new state
        // Optional: Refit graph when exiting fullscreen to adjust to new viewport?
        if (!isFullscreenActive() && currentSVG) {
             // Delay slightly to allow layout reflow
             setTimeout(() => fitGraphToView(false), 100);
        }
    }
    // =========================================


    // --- Utility Functions ---
    // Paste text from clipboard into editor
    function pasteFromClipboard() {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            showToast('剪贴板 API 不可用或无权限', "warning");
            console.warn('Clipboard readText API not available.');
            return;
        }
        navigator.clipboard.readText().then(text => {
            if (text && editor) {
                editor.replaceSelection(text); // Insert text at cursor
                showToast("已粘贴", "success");
                // Trigger auto-render if enabled
                if (autoRenderEnabled && !isRendering && viz) {
                    // Use timeout to allow editor update before rendering
                    setTimeout(() => renderGraph(true), 50);
                }
            } else if (!text) {
                showToast("剪贴板为空", "info");
            }
        }).catch(err => {
            console.error('无法访问剪贴板:', err);
            let errorMsg = "无法访问剪贴板";
            if (err.name === 'NotAllowedError') errorMsg = "需要剪贴板读取权限";
            else if (err.message.includes('secure context')) errorMsg = "剪贴板操作需要安全连接(HTTPS)";
            showToast(`${errorMsg}`, "error"); // Simplified error message
        });
    }

    // Display temporary notification messages
    function showToast(message, type = 'info', duration = 3000) {
        if (!toastContainer) return; // Need the container element

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        // Trigger reflow to enable CSS transition
        toast.offsetHeight;

        // Add 'show' class to fade in/slide up
        toast.classList.add('show');
        let timer1;

        const removeToast = () => {
            toast.classList.remove('show'); // Start fade out/slide down
            clearTimeout(timer1);
            // Remove element after transition completes
            toast.addEventListener('transitionend', () => {
                // Ensure it's still in the DOM before removing
                if (toast.parentNode === toastContainer) {
                    toastContainer.removeChild(toast);
                }
             }, { once: true }); // Listener cleans itself up
            // Failsafe removal in case transitionend doesn't fire
            setTimeout(() => {
                 if (toast.parentNode === toastContainer) {
                    toastContainer.removeChild(toast);
                 }
            }, duration + 500); // Wait for transition duration + buffer
        };

        // Set timer to remove the toast automatically
        timer1 = setTimeout(removeToast, duration);

        // Allow clicking the toast to dismiss it early
        toast.addEventListener('click', removeToast);
    }
    // --- End Utility Functions ---

    // --- Initialize ---
    // Wait for the DOM to be fully loaded before running init
    window.addEventListener('DOMContentLoaded', init);

})(); // End IIFE