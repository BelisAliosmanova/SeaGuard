window.setupFootage = (() => {
    'use strict';

    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    const FRAME_EDGE = 640;

    function captureFrame(source, width, height) {
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1, FRAME_EDGE / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Този браузър не може да подготви кадъра.');
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
            try {
                trigger();
            } catch (error) {
                cleanup();
                reject(error);
            }
        });
    }

    async function readVideo(url) {
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        video.playsInline = true;
        try {
            await mediaEvent(video, 'loadeddata', () => { video.src = url; }).catch(() => {
                throw new Error('Браузърът не отвори видеото. Опитай MP4 с H.264, WebM или отделни снимки.');
            });
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

    const isVideo = file => /^video\//.test(file.type) || /\.(mp4|webm)$/i.test(file.name);
    const isImage = file => /^(image\/jpeg|image\/png|image\/webp)$/.test(file.type)
        || /\.(jpe?g|png|webp)$/i.test(file.name);

    async function readFile(file) {
        if (file.size > MAX_FILE_SIZE) throw new Error('Избери файл до 100 MB.');
        const url = URL.createObjectURL(file);
        try {
            if (isVideo(file)) return await readVideo(url);
            if (!isImage(file)) throw new Error('Избери JPG, PNG, WebP, MP4 или WebM.');
            const image = new Image();
            await mediaEvent(image, 'load', () => { image.src = url; });
            return [{blob: await captureFrame(image, image.naturalWidth, image.naturalHeight), seconds: null}];
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function frameLabel(frame, index) {
        if (frame.seconds == null) return 'Снимка ' + (index + 1);
        const tenths = Math.round(frame.seconds * 10);
        const min = Math.floor(tenths / 600);
        const seconds = String(Math.floor(tenths / 10) % 60).padStart(2, '0');
        return `Кадър ${index + 1} · ${min}:${seconds},${tenths % 10}`;
    }

    function setupFootage(endpoint, {onResult, onTask, onFrames} = {}) {
        const byId = id => document.getElementById(id);
        const input = byId('footage-file');
        const analyzeButton = byId('analyze-file');
        const preview = byId('frame-preview');
        const result = byId('analysis-result');
        const status = byId('analysis-status');
        const taskButton = byId('footage-add-task');
        const taskStatus = byId('footage-task-status');
        let taskContext;
        let frames = [];
        let previewUrls = [];
        let fileVersion = 0;
        let activeRequest;
        let currentSite;

        function resetAnalysis() {
            activeRequest?.abort();
            activeRequest = undefined;
            result.hidden = true;
            taskContext = null;
            taskStatus.textContent = '';
            taskButton.disabled = true;
            if (currentSite) onResult?.(currentSite.id, null);
            status.textContent = '';
            analyzeButton.disabled = !currentSite || !frames.length;
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
            if (currentSite) onFrames?.(currentSite.id, newFrames.map((frame, index) => ({...frame, label: frameLabel(frame, index)})));
        }

        async function analyze() {
            if (!currentSite || frames.length === 0) return;
            resetAnalysis();
            const request = new AbortController();
            activeRequest = request;
            const fileFrames = frames;
            const site = currentSite;
            analyzeButton.disabled = true;
            status.textContent = 'AI екологът преглежда ' + fileFrames.length + ' кадъра. Това може да отнеме няколко минути.';
            const timeout = setTimeout(() => {
                if (activeRequest !== request) return;
                request.abort();
                status.textContent = 'Моделът се забави. Опитай с една снимка или провери прозореца на локалния сървър.';
            }, 195000);
            const form = new FormData();
            form.append('siteId', site.id);
            fileFrames.forEach((frame, index) => form.append('frames', frame.blob, `frame-${index + 1}.jpg`));
            try {
                const response = await fetch(endpoint, {
                    method: 'POST', body: form, headers: {'X-SeaGuard-Analysis': '1'}, signal: request.signal
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.message ||
                    (response.status === 404 ? 'Тази версия на SeaGuard няма връзката за анализ. Стартирай обновения проект.' :
                        'Анализът е недостъпен. Опитай отново.'));
                if (!Array.isArray(data.observations) || data.observations.length !== fileFrames.length
                    || typeof data.summary !== 'string' || typeof data.nextStep !== 'string') {
                    throw new Error('AI екологът върна непълен анализ. Опитай отново.');
                }
                if (request.signal.aborted) return;
                byId('analysis-provenance').textContent = `Участък „${site.name}“. Мястото и датата на заснемане са непотвърдени.`;
                const items = data.observations.map((text, index) => {
                    const item = document.createElement('li');
                    item.textContent = `${frameLabel(fileFrames[index], index)}. ${text}`;
                    return item;
                });
                byId('analysis-frames').replaceChildren(...items);
                byId('analysis-summary').textContent = data.summary;
                byId('analysis-next').textContent = data.nextStep;
                status.textContent = '';
                result.hidden = false;
                taskContext = {siteId: site.id, nextStep: data.nextStep};
                taskButton.disabled = !onTask;
                onResult?.(site.id, data);
                byId('analysis-title').focus();
            } catch (error) {
                if (!request.signal.aborted) {
                    status.textContent = error instanceof TypeError
                        ? 'Връзката с приложението прекъсна. Опитай отново.' : error.message;
                }
            } finally {
                clearTimeout(timeout);
                if (activeRequest === request) {
                    activeRequest = undefined;
                    analyzeButton.disabled = false;
                }
            }
        }

        input.addEventListener('change', async () => {
            const files = [...input.files];
            if (!files.length) return;
            const version = ++fileVersion;
            resetAnalysis();
            frames = [];
            renderFrames(frames);
            status.textContent = 'Подготвяме кадрите…';
            try {
                if (files.length > 3 || (files.length > 1 && files.some(isVideo))) {
                    throw new Error('Избери до три снимки или едно видео.');
                }
                const captured = [];
                for (const file of files) {
                    captured.push(...await readFile(file));
                    if (version !== fileVersion) return;
                }
                if (version !== fileVersion) return;
                frames = captured;
                renderFrames(frames);
                analyzeButton.disabled = !currentSite;
                if (!activeRequest) status.textContent = 'Подготвени кадри: ' + frames.length + '. Прегледай ги и започни анализа.';
            } catch (error) {
                if (version === fileVersion && !activeRequest) status.textContent = error.message;
            } finally {
                if (version === fileVersion) input.value = '';
            }
        });
        analyzeButton.addEventListener('click', analyze);
        taskButton.addEventListener('click', async () => {
            const context = taskContext;
            if (!context || taskButton.disabled) return;
            taskButton.disabled = true;
            const saved = await onTask(context.siteId, context.nextStep);
            if (taskContext !== context) return;
            taskStatus.textContent = saved ? 'Проверката е добавена в плана за терена.' : 'Задачата не се записа. Опитай отново.';
            taskButton.disabled = saved;
        });

        function clear() {
            fileVersion++;
            input.value = '';
            frames = [];
            renderFrames(frames);
            resetAnalysis();
        }

        return {
            clear,
            showUnavailable(message) {
                status.textContent = message;
            },
            selectSite(id, name) {
                if (currentSite?.id === id) return;
                currentSite = id == null ? null : {id, name};
                input.disabled = !currentSite;
                clear();
                if (currentSite) status.textContent = 'Кадрите ще се анализират за участък „' + name + '“. ';
            }
        };
    }
    return setupFootage;
})();
