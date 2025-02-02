/****************************************************
 * main.js
 * 说明：将所有逻辑封装在 IIFE 内，使用 Pointer Events 和
 *      requestAnimationFrame 优化拖拽、缩放、下载等操作。
 *      并增加缓存功能，将编辑器内容、预览变换以及布局状态
 *      保存在 localStorage 中，实现页面状态的记忆。
 ****************************************************/

(() => {
    // 本地存储 key
    const LOCAL_STORAGE_KEY = "graphMasterState";

    // 全局变量（模块内部作用域）
    let viz = null,
        currentSVG = null,
        editor = null;

    let scale = 1,
        minScale = 0.1,
        maxScale = 10,
        offsetX = 0,
        offsetY = 0;

    // 拖拽与缩放相关
    let isDragging = false,
        isPinching = false,
        dragStartX = 0,
        dragStartY = 0,
        initialPinchDistance = null,
        initialScale = 1,
        activePointers = new Map();

    // 分隔线拖拽标记
    let isResizing = false;

    // 使用 requestAnimationFrame 节流 transform 更新
    let lastTransformUpdateRequest = null;

    // 缓存 DOM 元素（在 init 中赋值）
    let renderBtn, clearBtn, pasteBtn, downloadBtn, downloadModal, closeModalBtn, modalButtons;
    let graphContainer, errorContainer, previewWrapper, resizer, editorContainer, previewContainer, mainContainer;

    // 初始化页面
    function init() {
        // 缓存 DOM 元素
        renderBtn = document.getElementById('render-btn');
        clearBtn = document.getElementById('clear-btn');
        pasteBtn = document.getElementById('paste-btn');
        downloadBtn = document.getElementById('download-btn');
        downloadModal = document.getElementById('download-modal');
        closeModalBtn = document.querySelector('.close-modal');
        modalButtons = document.querySelectorAll('.modal-button');
        graphContainer = document.getElementById('preview');
        errorContainer = document.getElementById('error');
        previewWrapper = document.getElementById('preview-wrapper');
        resizer = document.getElementById('resizer');
        editorContainer = document.getElementById('editor-container');
        previewContainer = document.getElementById('preview-container');
        mainContainer = document.getElementById('main');

        // 创建 Viz 实例
        viz = new Viz();

        // 初始化 CodeMirror
        editor = CodeMirror.fromTextArea(document.getElementById("dot-input"), {
            lineNumbers: true,
            lineWrapping: false,
            mode: "javascript",
            theme: "default"
        });
        const defaultDot = `digraph G {
    A -> B;
    B -> C;
    C -> A;
}`;
        // 尝试加载缓存状态
        const savedState = loadState();
        if (savedState && savedState.dot) {
            editor.setValue(savedState.dot);
        } else {
            editor.setValue(defaultDot);
        }

        // 绑定 CodeMirror 内容变化事件（节流保存状态）
        editor.on("change", debounce(saveState, 500));

        // 预览区域 Pointer Events 绑定（支持拖拽与双指缩放）
        previewWrapper.addEventListener('pointerdown', previewPointerDown);
        previewWrapper.addEventListener('pointermove', previewPointerMove);
        previewWrapper.addEventListener('pointerup', previewPointerUp);
        previewWrapper.addEventListener('pointercancel', previewPointerUp);

        // 鼠标滚轮缩放
        previewWrapper.addEventListener('wheel', previewWheelHandler);

        // 分隔线拖拽 Pointer Events 绑定
        resizer.addEventListener('pointerdown', resizerPointerDown);
        document.addEventListener('pointermove', resizerPointerMove);
        document.addEventListener('pointerup', resizerPointerUp);

        // 按钮事件绑定
        renderBtn.addEventListener('click', renderGraph);
        clearBtn.addEventListener('click', clearAll);
        pasteBtn.addEventListener('click', pasteFromClipboard);

        downloadBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            downloadModal.style.display = 'flex';
        });
        closeModalBtn.addEventListener('click', function(){
            downloadModal.style.display = 'none';
        });
        window.addEventListener('click', function(e){
            if (e.target === downloadModal) {
                downloadModal.style.display = 'none';
            }
        });
        modalButtons.forEach(button => {
            button.addEventListener('click', function(){
                const format = this.getAttribute('data-format');
                if (format) {
                    downloadGraph(format);
                    downloadModal.style.display = 'none';
                }
            });
        });

        // 恢复 transform 及布局状态（若存在缓存）
        if (savedState) {
            if (typeof savedState.scale === "number") scale = savedState.scale;
            if (typeof savedState.offsetX === "number") offsetX = savedState.offsetX;
            if (typeof savedState.offsetY === "number") offsetY = savedState.offsetY;
            if (savedState.editorFlex) editorContainer.style.flex = savedState.editorFlex;
            if (savedState.previewFlex) previewContainer.style.flex = savedState.previewFlex;
            updateTransform();
        }

        // 如果有 DOT 代码则自动渲染
        if (savedState && savedState.dot && savedState.dot.trim()) {
            renderGraph();
        }

        // 页面离开时保存状态
        window.addEventListener('beforeunload', saveState);
    }

    // 防抖函数
    function debounce(func, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    }

    // 保存状态到 localStorage
    function saveState() {
        if (!editor) return;
        const state = {
            dot: editor.getValue(),
            scale,
            offsetX,
            offsetY,
            editorFlex: editorContainer.style.flex,
            previewFlex: previewContainer.style.flex
        };
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error("保存状态失败: ", e);
        }
    }

    // 从 localStorage 加载状态
    function loadState() {
        try {
            const stateStr = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (stateStr) {
                return JSON.parse(stateStr);
            }
        } catch (e) {
            console.error("加载状态失败: ", e);
        }
        return null;
    }

    // 预览区域 Pointer Events 处理（拖拽与双指缩放）
    function previewPointerDown(e) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size === 1) {
            // 单指拖拽
            isDragging = true;
            dragStartX = e.clientX - offsetX;
            dragStartY = e.clientY - offsetY;
        } else if (activePointers.size === 2) {
            // 双指缩放
            isPinching = true;
            const points = Array.from(activePointers.values());
            initialPinchDistance = getDistance(points[0], points[1]);
            initialScale = scale;
        }
        e.target.setPointerCapture(e.pointerId);
    }

    function previewPointerMove(e) {
        if (!activePointers.has(e.pointerId)) return;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size === 1 && isDragging && !isPinching) {
            offsetX = e.clientX - dragStartX;
            offsetY = e.clientY - dragStartY;
            requestTransformUpdate();
        } else if (activePointers.size === 2) {
            const points = Array.from(activePointers.values());
            let currentDistance = getDistance(points[0], points[1]);
            if (initialPinchDistance !== null) {
                let delta = currentDistance / initialPinchDistance;
                scale = initialScale * delta;
                scale = Math.min(Math.max(scale, minScale), maxScale);
                requestTransformUpdate();
            }
        }
    }

    function previewPointerUp(e) {
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) {
            isPinching = false;
            initialPinchDistance = null;
        }
        if (activePointers.size === 0) {
            isDragging = false;
        }
        // 交互结束后保存状态
        saveState();
    }

    // 鼠标滚轮缩放处理
    function previewWheelHandler(e) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        scale += delta;
        scale = Math.min(Math.max(scale, minScale), maxScale);
        requestTransformUpdate();
        saveState();
    }

    // 分隔线拖拽 Pointer Events 处理
    function resizerPointerDown(e) {
        isResizing = true;
        document.body.style.cursor = window.innerWidth > 800 ? 'col-resize' : 'row-resize';
        e.target.setPointerCapture(e.pointerId);
    }

    function resizerPointerMove(e) {
        if (!isResizing) return;
        const rect = mainContainer.getBoundingClientRect();
        if (window.innerWidth > 800) {
            const offset = e.clientX - rect.left;
            const percentage = (offset / rect.width) * 100;
            if (percentage < 10 || percentage > 90) return;
            editorContainer.style.flex = `0 0 ${percentage}%`;
            previewContainer.style.flex = `1 1 ${100 - percentage}%`;
        } else {
            const offset = e.clientY - rect.top;
            const percentage = (offset / rect.height) * 100;
            if (percentage < 10 || percentage > 90) return;
            editorContainer.style.flex = `0 0 ${percentage}%`;
            previewContainer.style.flex = `1 1 ${100 - percentage}%`;
        }
        saveState();
    }

    function resizerPointerUp(e) {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
            saveState();
        }
    }

    // requestAnimationFrame 节流 transform 更新
    function requestTransformUpdate() {
        if (lastTransformUpdateRequest !== null) return;
        lastTransformUpdateRequest = requestAnimationFrame(() => {
            updateTransform();
            lastTransformUpdateRequest = null;
        });
    }

    function updateTransform() {
        if (!graphContainer) return;
        graphContainer.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    }

    // 计算两点之间距离（用于触摸缩放）
    function getDistance(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // 使用 Viz.js 渲染 DOT 代码
    function renderGraph() {
        const dot = editor.getValue();
        errorContainer.textContent = '';
        if (!dot.trim()) {
            errorContainer.textContent = '请在文本区域输入有效的 DOT 代码。';
            graphContainer.innerHTML = '';
            return;
        }
        viz.renderSVGElement(dot)
            .then(element => {
                graphContainer.innerHTML = '';
                graphContainer.appendChild(element);
                currentSVG = element;
                fitGraphToView();
                saveState();
            })
            .catch(error => {
                errorContainer.textContent = '渲染错误: ' + error.message;
                graphContainer.innerHTML = '';
                viz = new Viz();
            });
    }

    // 自动缩放、平移以适应预览窗口
    function fitGraphToView() {
        if (!currentSVG) return;
        const bbox = currentSVG.getBBox();
        const width = bbox.width;
        const height = bbox.height;
        const containerWidth = previewWrapper.clientWidth;
        const containerHeight = previewWrapper.clientHeight;
        let scaleFactor = Math.min(containerWidth / width, containerHeight / height);
        scale = scaleFactor > 1 ? 1 : scaleFactor;
        offsetX = (containerWidth - width * scale) / 2 - bbox.x * scale;
        offsetY = (containerHeight - height * scale) / 2 - bbox.y * scale;
        updateTransform();
    }

    // 清空编辑器和预览区域
    function clearAll() {
        editor.setValue('');
        graphContainer.innerHTML = '';
        errorContainer.textContent = '';
        resetTransform();
        updateTransform();
        saveState();
    }

    function resetTransform() {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
    }

    // 从剪贴板粘贴内容
    async function pasteFromClipboard() {
        try {
            if (!navigator.clipboard || !navigator.clipboard.readText) {
                alert('此浏览器不支持或未授权访问剪贴板，请使用现代浏览器并确保HTTPS环境下运行。');
                return;
            }
            const text = await navigator.clipboard.readText();
            if (text) {
                editor.replaceSelection(text);
            } else {
                alert('剪贴板为空或无法访问剪贴板内容。');
            }
        } catch (err) {
            alert('无法访问剪贴板内容，请确保已授权浏览器访问剪贴板：\n' + err);
        }
    }

    // 将 SVG 转换为 canvas（用于 PNG 与 PDF 下载）
    function svgToCanvas(svgElement, dpi, callback) {
        const serializer = new XMLSerializer();
        let svgData = serializer.serializeToString(svgElement);
        const img = new Image();
        const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);
        img.onload = function() {
            const bbox = svgElement.getBBox();
            const canvas = document.createElement('canvas');
            canvas.width = bbox.width * dpi / 96;
            canvas.height = bbox.height * dpi / 96;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            callback(canvas);
        };
        img.onerror = function() {
            alert('无法加载SVG图像。');
            URL.revokeObjectURL(url);
        };
        img.src = url;
    }

    // 下载图形（支持 svg/png/pdf）
    function downloadGraph(format) {
        if (!currentSVG) {
            alert('请先渲染图形再下载。');
            return;
        }
        const dpi = 600;
        if (format === 'svg') {
            const serializer = new XMLSerializer();
            let svgData = serializer.serializeToString(currentSVG);
            const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
            saveAs(blob, "graph.svg");
        } else if (format === 'png') {
            svgToCanvas(currentSVG, dpi, function(canvas) {
                canvas.toBlob(function(blob) {
                    saveAs(blob, "graph.png");
                }, 'image/png');
            });
        } else if (format === 'pdf') {
            svgToCanvas(currentSVG, dpi, function(canvas) {
                const imgData = canvas.toDataURL('image/png');
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF({
                    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
                    unit: 'pt',
                    format: [canvas.width, canvas.height]
                });
                pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
                pdf.save("graph.pdf");
            });
        }
    }

    // DOMContentLoaded 后初始化
    window.addEventListener('DOMContentLoaded', init);
})();