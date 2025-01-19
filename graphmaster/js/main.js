/****************************************************
 * main.js
 * 说明：把原先 index.html 里 <script>...</script> 
 *      中所有的逻辑移动到这个文件里。
 ****************************************************/

// 先声明一些全局变量
let viz = null;
let currentSVG = null;
let editor = null;

// 缩放与平移相关变量
let scale = 1;
const minScale = 0.1;
const maxScale = 10;
let offsetX = 0;
let offsetY = 0;

// 鼠标拖拽相关
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

// 触摸缩放
let isPanning = false;
let initialDistance = null;
let initialScale = 1;

// 当 DOM 内容就绪后再执行初始化
window.addEventListener('DOMContentLoaded', init);

/**
 * 页面初始化
 */
function init() {
    // 创建 Viz 实例
    viz = new Viz();

    // ========== 1. 获取 DOM 元素 ========== 
    const renderBtn = document.getElementById('render-btn');
    const clearBtn = document.getElementById('clear-btn');
    const pasteBtn = document.getElementById('paste-btn');
    const downloadBtn = document.getElementById('download-btn');
    const downloadModal = document.getElementById('download-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const modalButtons = document.querySelectorAll('.modal-button');

    // 预览相关
    const graphContainer = document.getElementById('preview');
    const errorContainer = document.getElementById('error');
    const previewWrapper = document.getElementById('preview-wrapper');

    // 分隔线拖拽相关
    const resizer = document.getElementById('resizer');
    const editorContainer = document.getElementById('editor-container');
    const previewContainer = document.getElementById('preview-container');

    // ========== 2. 初始化 CodeMirror ========== 
    editor = CodeMirror.fromTextArea(document.getElementById("dot-input"), {
        lineNumbers: true,   // 显示行号
        lineWrapping: false, // 长行不自动换行，用水平滚动条
        mode: "javascript",
        theme: "default"
    });
    // 默认示例
    const defaultDot = `digraph G {
    A -> B;
    B -> C;
    C -> A;


}`;
    editor.setValue(defaultDot);

    // ========== 3. 按钮事件绑定 ========== 
    renderBtn.addEventListener('click', () => renderGraph(graphContainer, errorContainer, previewWrapper));
    clearBtn.addEventListener('click', () => clearAll(graphContainer, errorContainer));
    pasteBtn.addEventListener('click', pasteFromClipboard);
    
    downloadBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        downloadModal.style.display = 'flex';
    });
    closeModalBtn.addEventListener('click', function() {
        downloadModal.style.display = 'none';
    });
    window.addEventListener('click', function(event) {
        if (event.target === downloadModal) {
            downloadModal.style.display = 'none';
        }
    });
    modalButtons.forEach(function(button) {
        button.addEventListener('click', function() {
            const format = this.getAttribute('data-format');
            if (format) {
                downloadGraph(format, graphContainer);
                downloadModal.style.display = 'none';
            }
        });
    });

    // ========== 4. 分隔线拖拽事件 ========== 
    let isResizing = false;
    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
    });
    resizer.addEventListener('touchstart', function(e) {
        isResizing = true;
        document.body.style.cursor = window.innerWidth > 800 ? 'col-resize' : 'row-resize';
        e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;
        const main = document.getElementById('main');
        const rect = main.getBoundingClientRect();
        if (window.innerWidth > 800) {
            const offset = e.clientX - rect.left;
            const percentage = (offset / rect.width) * 100;
            if (percentage < 10 || percentage > 90) return; 
            editorContainer.style.flex = `0 0 ${percentage}%`;
            previewContainer.style.flex = `1 1 ${100 - percentage}%`;
        }
    });
    document.addEventListener('touchmove', function(e) {
        if (!isResizing) return;
        const main = document.getElementById('main');
        const rect = main.getBoundingClientRect();
        if (window.innerWidth > 800 && e.touches.length === 1) {
            const offset = e.touches[0].clientX - rect.left;
            const percentage = (offset / rect.width) * 100;
            if (percentage < 10 || percentage > 90) return;
            editorContainer.style.flex = `0 0 ${percentage}%`;
            previewContainer.style.flex = `1 1 ${100 - percentage}%`;
        } else if (window.innerWidth <= 800 && e.touches.length === 1) {
            const offset = e.touches[0].clientY - rect.top;
            const percentage = (offset / rect.height) * 100;
            if (percentage < 10 || percentage > 90) return;
            editorContainer.style.flex = `0 0 ${percentage}%`;
            previewContainer.style.flex = `1 1 ${100 - percentage}%`;
        }
    });
    document.addEventListener('mouseup', function() {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
        }
    });
    document.addEventListener('touchend', function() {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
        }
    });

    // ========== 5. 预览区域鼠标/触摸缩放平移绑定 ========== 
    // 鼠标滚轮缩放 (桌面端)
    previewWrapper.addEventListener('wheel', function(event) {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.1 : -0.1;
        scale += delta;
        scale = Math.min(Math.max(scale, minScale), maxScale);
        updateTransform(graphContainer);
    });

    // 鼠标左键拖拽平移 (桌面端)
    previewWrapper.addEventListener('mousedown', function(event) {
        if (event.button === 0) {
            isDragging = true;
            dragStartX = event.clientX - offsetX;
            dragStartY = event.clientY - offsetY;
            previewWrapper.style.cursor = 'grabbing';
        }
    });
    document.addEventListener('mousemove', function(event) {
        if (isDragging) {
            offsetX = event.clientX - dragStartX;
            offsetY = event.clientY - dragStartY;
            updateTransform(graphContainer);
        }
    });
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            previewWrapper.style.cursor = 'grab';
        }
    });

    // 触摸缩放平移 (移动端)
    previewWrapper.addEventListener('touchstart', function(event) {
        if (event.touches.length === 1) {
            isPanning = true;
            initialDistance = null;
            dragStartX = event.touches[0].clientX - offsetX;
            dragStartY = event.touches[0].clientY - offsetY;
        } else if (event.touches.length === 2) {
            isPanning = false;
            initialDistance = getDistance(event.touches[0], event.touches[1]);
            initialScale = scale;
        }
    });
    previewWrapper.addEventListener('touchmove', function(event) {
        if (event.touches.length === 1 && isPanning && !initialDistance) {
            event.preventDefault();
            offsetX = event.touches[0].clientX - dragStartX;
            offsetY = event.touches[0].clientY - dragStartY;
            updateTransform(graphContainer);
        } else if (event.touches.length === 2) {
            event.preventDefault();
            const currentDistance = getDistance(event.touches[0], event.touches[1]);
            const delta = (currentDistance / initialDistance) - 1;
            scale = initialScale + delta;
            scale = Math.min(Math.max(scale, minScale), maxScale);
            updateTransform(graphContainer);
        }
    });
    previewWrapper.addEventListener('touchend', function(event) {
        if (event.touches.length < 2) {
            initialDistance = null;
        }
        if (event.touches.length === 0) {
            isPanning = false;
        }
    });

    // ========== 6. 页面打开后自动渲染一次 ========== 
    renderGraph(graphContainer, errorContainer, previewWrapper);
}

/**
 * 渲染 DOT 代码 
 */
function renderGraph(graphContainer, errorContainer, previewWrapper) {
    if (!editor) return;
    const dot = editor.getValue();
    errorContainer.textContent = '';

    if (!dot.trim()) {
        errorContainer.textContent = '请在文本区域输入有效的 DOT 代码。';
        graphContainer.innerHTML = '';
        return;
    }

    // 使用 Viz.js 渲染
    viz.renderSVGElement(dot)
        .then(function(element) {
            graphContainer.innerHTML = '';
            graphContainer.appendChild(element);
            currentSVG = element;
            fitGraphToView(previewWrapper);
        })
        .catch(function(error) {
            errorContainer.textContent = '渲染错误: ' + error.message;
            graphContainer.innerHTML = '';
            // 若发生错误，需要重新实例化 Viz
            viz = new Viz();
        });
}

/**
 * 将渲染后的图形自动缩放、平移以适应预览窗口 
 */
function fitGraphToView(previewWrapper) {
    if (!currentSVG) return;

    const bbox = currentSVG.getBBox();
    const width = bbox.width;
    const height = bbox.height;
    const containerWidth = previewWrapper.clientWidth;
    const containerHeight = previewWrapper.clientHeight;

    // 计算合适的缩放比
    let scaleFactor = Math.min(containerWidth / width, containerHeight / height);
    scale = scaleFactor > 1 ? 1 : scaleFactor;

    // 居中对齐
    offsetX = (containerWidth - width * scale) / 2 - bbox.x * scale;
    offsetY = (containerHeight - height * scale) / 2 - bbox.y * scale;
    updateTransform(document.getElementById('preview'));
}

/**
 * 复位缩放平移
 */
function resetTransform() {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
}

/**
 * 清空输入和预览
 */
function clearAll(graphContainer, errorContainer) {
    if (!editor) return;
    editor.setValue('');
    graphContainer.innerHTML = '';
    errorContainer.textContent = '';
    resetTransform();
    updateTransform(graphContainer);
}

/**
 * 更新预览区域的 transform
 */
function updateTransform(graphContainer) {
    if (!graphContainer) return;
    graphContainer.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

/**
 * 从剪贴板粘贴
 */
async function pasteFromClipboard() {
    try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            alert('此浏览器不支持或未授权访问剪贴板，请使用现代浏览器并确保HTTPS环境下运行。');
            return;
        }
        const text = await navigator.clipboard.readText();
        if (text) {
            // 将剪贴板内容插入到当前光标处
            editor.replaceSelection(text);
        } else {
            alert('剪贴板为空或无法访问剪贴板内容。');
        }
    } catch (err) {
        alert('无法访问剪贴板内容，请确保已授权浏览器访问剪贴板：\n' + err);
    }
}

/**
 * 下载图形 (支持 svg/png/pdf)
 */
function downloadGraph(format, graphContainer) {
    if (!currentSVG) {
        alert('请先渲染图形再下载。');
        return;
    }

    const serializer = new XMLSerializer();
    let svgData = serializer.serializeToString(currentSVG);

    // 用于矢量与位图转换的分辨率
    const dpi = 600;

    if (format === 'svg') {
        const blob = new Blob([svgData], {type: "image/svg+xml;charset=utf-8"});
        saveAs(blob, "graph.svg");
    } else if (format === 'png') {
        const img = new Image();
        const svgBlob = new Blob([svgData], {type: "image/svg+xml;charset=utf-8"});
        const url = URL.createObjectURL(svgBlob);
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const bbox = currentSVG.getBBox();
            canvas.width = bbox.width * dpi / 96;
            canvas.height = bbox.height * dpi / 96;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            canvas.toBlob(function(blob) {
                saveAs(blob, "graph.png");
            }, 'image/png');
        };
        img.onerror = function() {
            alert('无法加载SVG图像。');
            URL.revokeObjectURL(url);
        };
        img.src = url;
    } else if (format === 'pdf') {
        const img = new Image();
        const svgBlob = new Blob([svgData], {type: "image/svg+xml;charset=utf-8"});
        const url = URL.createObjectURL(svgBlob);
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const bbox = currentSVG.getBBox();
            canvas.width = bbox.width * dpi / 96;
            canvas.height = bbox.height * dpi / 96;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);

            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({
                orientation: bbox.width > bbox.height ? 'landscape' : 'portrait',
                unit: 'pt',
                format: [canvas.width, canvas.height]
            });
            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save("graph.pdf");
        };
        img.onerror = function() {
            alert('无法加载SVG图像。');
            URL.revokeObjectURL(url);
        };
        img.src = url;
    }
}

/**
 * 计算两触点距离，用于触摸缩放
 */
function getDistance(touch1, touch2) {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx*dx + dy*dy);
}