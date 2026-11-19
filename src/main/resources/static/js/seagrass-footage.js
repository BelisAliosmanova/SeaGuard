const MAX_FILE_SIZE = 100 * 1024 * 1024;
const FRAME_EDGE = 640;

function captureFrame(source, width, height) {
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, FRAME_EDGE / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Кадърът не може да се прочете.')), 'image/jpeg', .85
    ));
}

function mediaEvent(media, event, trigger) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            media.removeEventListener(event, success);
            media.removeEventListener('error', failure);
        };
        const success = () => { cleanup(); resolve(); };
        const failure = () => { cleanup(); reject(new Error('Файлът не може да се прочете от този браузър.')); };
        const timer = setTimeout(failure, 8000);
        media.addEventListener(event, success, {once: true});
        media.addEventListener('error', failure, {once: true});
        trigger();
    });
}

async function readVideo(url) {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    try {
        await mediaEvent(video, 'loadeddata', () => { video.src = url; });
        if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) {
            throw new Error('Видеото няма четими кадри.');
        }
        const fractions = video.duration < 1.5 ? [.5] : [.2, .5, .8];
        const frames = [];
        for (const fraction of fractions) {
            const seconds = video.duration * fraction;
            await mediaEvent(video, 'seeked', () => { video.currentTime = seconds; });
            frames.push({blob: await captureFrame(video, video.videoWidth, video.videoHeight), seconds});
        }
        return frames;
    } finally {
        video.removeAttribute('src');
        video.load();
    }
}

async function readFile(file) {
    if (file.size > MAX_FILE_SIZE) throw new Error('Избери файл до 100 MB.');
    const url = URL.createObjectURL(file);
    try {
        if (/^video\//.test(file.type) || /\.(mp4|webm)$/i.test(file.name)) return await readVideo(url);
        const image = new Image();
        await mediaEvent(image, 'load', () => { image.src = url; });
        return [{blob: await captureFrame(image, image.naturalWidth, image.naturalHeight), seconds: null}];
    } finally {
        URL.revokeObjectURL(url);
    }
}

function frameLabel(frame, index) {
    if (frame.seconds == null) return 'Снимка';
    const tenths = Math.round(frame.seconds * 10);
    const min = Math.floor(tenths / 600);
    const seconds = String(Math.floor(tenths / 10) % 60).padStart(2, '0');
    return `Кадър ${index + 1} · ${min}:${seconds},${tenths % 10}`;
}

export function setupFootage(endpoint) {
    const byId = id => document.getElementById(id);
    const input = byId('footage-file');
    const exampleButton = byId('analyze-example');
    const analyzeButton = byId('analyze-file');
    const preview = byId('frame-preview');
    const result = byId('analysis-result');
    const status = byId('analysis-status');
    let frames = [];
    let previewUrls = [];
    let fileVersion = 0;
    let activeRequest;
    let currentSite;

    function resetAnalysis() {
        activeRequest?.abort();
        activeRequest = undefined;
        result.hidden = true;
        status.textContent = '';
        exampleButton.disabled = !currentSite;
        analyzeButton.disabled = !currentSite;
    }

    function renderFrames(newFrames) {
        previewUrls.forEach(url => URL.revokeObjectURL(url));
        previewUrls = [];
        const figures = newFrames.map((frame, index) => {
            const figure = document.createElement('figure');
            const image = document.createElement('img');
            const url = URL.createObjectURL(frame.blob);
            previewUrls.push(url);
            image.src = url;
            image.alt = '';
            const caption = document.createElement('figcaption');
            caption.textContent = frameLabel(frame, index);
            figure.append(image, caption);
            return figure;
        });
        preview.replaceChildren(...figures);
        preview.hidden = figures.length === 0;
        analyzeButton.hidden = figures.length === 0;
    }

    async function analyze(example) {
        if (!currentSite || (!example && frames.length === 0)) return;
        resetAnalysis();
        const request = new AbortController();
        activeRequest = request;
        const fileFrames = frames;
        const site = currentSite;
        exampleButton.disabled = true;
        analyzeButton.disabled = true;
        status.textContent = 'Локалният модел разглежда кадрите…';
        const form = new FormData();
        form.append('siteId', site.id);
        form.append('example', example);
        if (!example) fileFrames.forEach((frame, index) => form.append('frames', frame.blob, `frame-${index + 1}.jpg`));
        try {
            const response = await fetch(endpoint, {
                method: 'POST', body: form, headers: {'X-SeaGuard-Analysis': '1'}, signal: request.signal
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.message || 'Анализът е недостъпен. Опитай отново.');
            if (request.signal.aborted) return;
            byId('analysis-provenance').textContent = example
                ? `Контекст: ${site.name}. Научен кадър от района на Равда с непотвърдена връзка с конкретния полигон.`
                : `Контекст: ${site.name}. Кадрите са подадени от потребител, с непотвърдени място и дата.`;
            const items = data.observations.map((text, index) => {
                const item = document.createElement('li');
                item.textContent = example ? text : `${frameLabel(fileFrames[index], index)}. ${text}`;
                return item;
            });
            byId('analysis-frames').replaceChildren(...items);
            byId('analysis-summary').textContent = data.summary;
            byId('analysis-next').textContent = data.nextStep;
            status.textContent = '';
            result.hidden = false;
            byId('analysis-title').focus();
        } catch (error) {
            if (!request.signal.aborted) {
                status.textContent = error instanceof TypeError
                    ? 'Връзката с приложението прекъсна. Опитай отново.' : error.message;
            }
        } finally {
            if (activeRequest === request) {
                activeRequest = undefined;
                exampleButton.disabled = false;
                analyzeButton.disabled = false;
            }
        }
    }

    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const version = ++fileVersion;
        resetAnalysis();
        frames = [];
        renderFrames(frames);
        status.textContent = 'Подготвяме кадрите…';
        try {
            const captured = await readFile(file);
            if (version !== fileVersion) return;
            frames = captured;
            renderFrames(frames);
            if (!activeRequest) status.textContent = 'Кадрите са готови за анализ.';
        } catch (error) {
            if (version === fileVersion && !activeRequest) status.textContent = error.message;
        } finally {
            if (version === fileVersion) input.value = '';
        }
    });
    exampleButton.addEventListener('click', () => analyze(true));
    analyzeButton.addEventListener('click', () => analyze(false));

    return {
        selectSite(id, name) {
            currentSite = {id, name};
            resetAnalysis();
        }
    };
}
