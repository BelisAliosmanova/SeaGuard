(() => {
    'use strict';

    const $ = id => document.getElementById(id);
    const urls = $('workspace').dataset;
    const dialog = $('new-topic');
    const topicForm = $('topic-form');
    const replyForm = $('reply-form');
    const scroll = $('message-scroll');
    const category = $('filter-category');
    const site = $('filter-site');
    const initialLink = new URL(location.href);
    const dateTime = new Intl.DateTimeFormat('bg-BG', {dateStyle: 'short', timeStyle: 'short'});
    const monthFormat = new Intl.DateTimeFormat('bg-BG', {month: 'short', year: 'numeric', timeZone: 'UTC'});
    const numberFormat = new Intl.NumberFormat('bg-BG', {maximumFractionDigits: 2});
    const postHeaders = {'X-Blue-Root-Community': '1'};
    const authorKey = 'blue-root-community-name';
    let name = '';
    try { name = localStorage.getItem(authorKey) || ''; } catch {}
    let current;
    let page = 0;
    let listVersion = 0;
    let listSignature;

    function element(tag, content, className) {
        const node = document.createElement(tag);
        if (content != null) node.textContent = content;
        if (className) node.className = className;
        return node;
    }

    function status(id, message = '', error = false) {
        const node = $(id);
        if (node.textContent !== message) node.textContent = message;
        node.classList.toggle('is-error', error);
    }

    async function getJSON(url, options) {
        const response = await fetch(url, {cache: 'no-store', ...options});
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || 'Заявката не завърши. Опитай отново.');
        }
        return response.json();
    }

    function errorMessage(error) {
        return error instanceof TypeError ? 'Връзката прекъсна. Опитай отново.' : error.message;
    }

    function readingText(reading) {
        const month = monthFormat.format(new Date(reading.month + '-01T00:00:00Z'));
        return reading.label + ' · ' + numberFormat.format(reading.value) + ' ' + reading.unit
            + ' · ' + month + ' · ' + reading.source;
    }

    function topicMeta(topic) {
        return [topic.category, topic.siteName, topic.investigation ? 'Разследване' : null].filter(Boolean).join(' · ');
    }

    async function refreshList(quiet = false) {
        const version = ++listVersion;
        const query = new URLSearchParams({page});
        if (category.value) query.set('category', category.value);
        if (site.value) query.set('siteId', site.value);
        try {
            const data = await getJSON(urls.topics + '?' + query);
            if (version !== listVersion) return;
            const signature = JSON.stringify([page, current?.id, data]);
            if (signature !== listSignature) {
                const focused = document.activeElement?.closest('#topics button')?.dataset.topic;
                const entries = data.topics.map(topic => {
                    const item = element('li');
                    const button = element('button');
                    button.type = 'button';
                    button.dataset.topic = topic.id;
                    if (current?.id === topic.id) button.setAttribute('aria-current', 'true');
                    const replies = topic.replies + (topic.replies === 1 ? ' отговор' : ' отговора');
                    button.append(element('strong', topic.title), element('span', topicMeta(topic)),
                        element('span', replies));
                    button.addEventListener('click', () => selectTopic(topic.id, true));
                    item.append(button);
                    return item;
                });
                $('topics').replaceChildren(...entries);
                if (focused) $('topics').querySelector('[data-topic="' + focused + '"]')?.focus({preventScroll: true});
                listSignature = signature;
            }
            status('directory-status', data.topics.length ? '' : 'Тук още няма дискусии. Можеш да започнеш първата.');
            $('topic-pages').hidden = page === 0 && !data.hasMore;
            $('previous-topics').disabled = page === 0;
            $('next-topics').disabled = !data.hasMore;
        } catch (error) {
            if (version === listVersion && (!quiet || !listSignature)) status('directory-status', errorMessage(error), true);
        }
    }

    function selectTopic(id, focus) {
        if (current?.id === id) return;
        const state = {id, version: 0, entries: [], before: null, loadedOlder: false, forceBottom: true, focus};
        current = state;
        $('discussion').hidden = true;
        $('community-welcome').hidden = true;
        $('summary-panel').hidden = true;
        $('messages').replaceChildren();
        $('older-posts').disabled = false;
        $('summarize-discussion').disabled = false;
        $('summarize-discussion').querySelector('span').textContent = 'Обобщи с Pickle';
        $('save-discussion-task').disabled = false;
        replyForm.reset();
        replyForm.elements.author.value = name;
        replyForm.querySelector('button[type=submit]').disabled = false;
        status('reply-status');
        status('investigation-status');
        status('discussion-status', 'Зареждаме публикациите…');
        const address = new URL(location.href);
        address.searchParams.set('topic', id);
        history.replaceState(null, '', address);
        refreshDiscussion(state);
        refreshList(true);
    }

    function renderPost(state, post) {
        const container = element('li');
        const heading = element('header');
        const date = element('time', dateTime.format(new Date(post.createdAt)));
        date.dateTime = post.createdAt;
        heading.append(element('strong', post.author), date);
        container.append(heading, element('p', post.message, 'message-body'));
        if (post.reading) container.append(element('p', readingText(post.reading), 'message-reading'));
        if (post.hasPhoto) {
            const picture = element('figure', null, 'message-photo');
            const link = element('a');
            link.href = urls.topics + '/' + state.id + '/posts/' + post.id + '/photo';
            link.target = '_blank';
            link.rel = 'noopener';
            const img = element('img');
            img.src = link.href;
            img.alt = 'Снимка, приложена от ' + post.author;
            img.loading = 'lazy';
            link.append(img);
            picture.append(link, element('figcaption', 'Кадър от участник · мястото и датата са непотвърдени.'));
            container.append(picture);
        }
        return container;
    }

    function displayEntries(state, entries, before, prepend = false) {
        const previous = state.entries;
        const next = prepend || state.loadedOlder
            ? [...new Map([...previous, ...entries].map(post => [post.id, post])).values()].sort((a, b) => a.id - b.id)
            : entries;
        if (prepend || !state.loadedOlder) state.before = before;
        $('older-posts').hidden = state.before == null;
        const meta = $('messages');
        const first = meta.firstElementChild;
        if (previous.length === next.length && previous.every((post, index) => next[index].id === post.id)) {
            if (state.forceBottom) scroll.scrollTop = scroll.scrollHeight;
            state.forceBottom = false;
            return;
        }
        const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 56;
        const height = scroll.scrollHeight;
        const top = scroll.scrollTop;
        if (prepend && first && next.at(-1)?.id === previous.at(-1)?.id) {
            const added = next.slice(0, next.findIndex(post => post.id === previous[0].id));
            first.before(...added.map(post => renderPost(state, post)));
        } else if (previous.every((post, index) => next[index]?.id === post.id)) {
            meta.append(...next.slice(previous.length).map(post => renderPost(state, post)));
        } else {
            meta.replaceChildren(...next.map(post => renderPost(state, post)));
        }
        state.entries = next;
        if (prepend) scroll.scrollTop = top + scroll.scrollHeight - height;
        else if (state.forceBottom || atBottom) scroll.scrollTop = scroll.scrollHeight;
        state.forceBottom = false;
    }

    function displayTask(task) {
        const label = !task ? 'Отворено разследване' : task.done ? 'Проверката е изпълнена' : 'Планирана проверка';
        $('task-stage').textContent = label;
        $('save-discussion-task').hidden = Boolean(task);
        $('discussion-task-link').hidden = !task;
    }

    async function refreshDiscussion(state, quiet = false) {
        if (quiet && state.loading) return;
        const version = ++state.version;
        state.loading = true;
        try {
            const discussion = await getJSON(urls.topics + '/' + state.id);
            if (state !== current || version !== state.version) return;
            state.data = discussion;
            const {topic, task, posts, before} = discussion;
            $('discussion-meta').textContent = topicMeta(topic);
            $('discussion-title').textContent = topic.title;
            const siteLink = $('discussion-site');
            siteLink.hidden = !topic.siteId;
            if (topic.siteId) siteLink.href = urls.sites + '?site=' + topic.siteId;
            replyForm.elements.metric.disabled = !topic.siteId;
            $('investigation').hidden = !topic.investigation;
            displayTask(task);
            $('discussion').hidden = false;
            displayEntries(state, posts, before);
            if (state.summary && state.summary.replies < topic.replies && !state.summarizing) {
                status('investigation-status', 'Има нови отговори. Можеш да обновиш обобщението.');
            }
            if (state.focus) {
                $('discussion-title').focus();
                state.focus = false;
            }
            status('discussion-status');
        } catch (error) {
            if (state === current && version === state.version && (!quiet || !state.data)) {
                status('discussion-status', errorMessage(error), true);
            }
        } finally {
            if (version === state.version) state.loading = false;
        }
    }

    async function olderPosts() {
        const state = current;
        if (!state?.before) return;
        const button = $('older-posts');
        button.disabled = true;
        try {
            const data = await getJSON(urls.topics + '/' + state.id + '?before=' + state.before);
            if (state !== current) return;
            displayEntries(state, data.posts, data.before, true);
            state.loadedOlder = true;
            status('discussion-status');
        } catch (error) {
            if (state === current) status('discussion-status', errorMessage(error), true);
        } finally {
            if (state === current) button.disabled = false;
        }
    }

    async function preparePhoto(file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
            !/\.(jpg|jpeg|png|webp)$/i.test(file.name)) {
            throw new Error('Избери снимка във формат JPG, PNG или WebP.');
        }
        if (file.size > 12 * 1024 * 1024) throw new Error('Избери снимка до 12 MB.');
        const image = await createImageBitmap(file).catch(() => {
            throw new Error('Снимката не може да се отвори.');
        });
        try {
            const ratio = Math.min(1, 960 / Math.max(image.width, image.height));
            const canvas = element('canvas');
            canvas.width = Math.max(1, Math.round(image.width * ratio));
            canvas.height = Math.max(1, Math.round(image.height * ratio));
            const context = canvas.getContext('2d');
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            return await new Promise((resolve, reject) => canvas.toBlob(
                blob => blob ? resolve(blob) : reject(new Error('Снимката не може да се подготви.')), 'image/jpeg', .84
            ));
        } finally {
            image.close();
        }
    }

    async function publish(url, form) {
        const body = new FormData(form);
        for (const key of ['metric', 'siteId']) if (!body.get(key)) body.delete(key);
        const file = body.get('photo');
        if (file?.size) body.set('photo', await preparePhoto(file), 'snapshot.jpg');
        else body.delete('photo');
        const saved = await getJSON(url, {method: 'POST', headers: postHeaders, body});
        name = body.get('author').trim();
        try { localStorage.setItem(authorKey, name); } catch {}
        return saved;
    }

    function updateTopicFields() {
        const {investigation, siteId, metric} = topicForm.elements;
        siteId.required = investigation.checked;
        metric.disabled = !siteId.value;
        if (metric.disabled) metric.value = '';
    }

    function renderSummary(data) {
        const card = $('pickle-summary');
        const quote = item => item.author + ' · „' + item.excerpt + '“';
        const notes = element('ul');
        for (const entry of data.notes) notes.append(element('li', quote(entry)));
        const readings = element('ul');
        for (const reading of data.readings) readings.append(element('li', readingText(reading)));

        card.replaceChildren(element('strong', 'Начално наблюдение'), element('p', quote(data.opening)));
        if (data.notes.length) card.append(element('strong', 'Наблюдения от отговорите'), notes);
        if (data.readings.length) card.append(element('strong', 'Споделени показатели'), readings);
        if (data.photos) card.append(element('p', 'Снимки от участници · ' + data.photos));
        card.append(element('p', data.limitations, 'community-status'), element('strong', 'Какво да проверим'),
            element('p', data.nextStep));
        const panel = $('summary-panel');
        panel.hidden = false;
        panel.open = true;
    }

    $('summarize-discussion').addEventListener('click', async () => {
        const state = current;
        const button = $('summarize-discussion');
        button.disabled = true;
        state.summarizing = true;
        status('investigation-status', 'Pickle обобщава дискусията…');
        try {
            const data = await getJSON(urls.topics + '/' + state.id + '/summary');
            if (state !== current) return;
            state.summary = data;
            renderSummary(data);
            button.querySelector('span').textContent = 'Обнови обобщението';
            status('investigation-status');
        } catch (error) {
            if (state === current) status('investigation-status', errorMessage(error), true);
        } finally {
            state.summarizing = false;
            if (state === current) button.disabled = false;
        }
    });

    $('save-discussion-task').addEventListener('click', async () => {
        const state = current;
        const button = $('save-discussion-task');
        button.disabled = true;
        status('investigation-status', 'Добавяме проверката…');
        try {
            const task = await getJSON(urls.topics + '/' + state.id + '/task', {method: 'POST', headers: postHeaders});
            if (state !== current) return;
            displayTask(task);
            status('investigation-status', 'Проверката е добавена в плана за терена.');
            refreshDiscussion(state, true);
            refreshList(true);
        } catch (error) {
            if (state === current) status('investigation-status', errorMessage(error), true);
        } finally {
            if (state === current) button.disabled = false;
        }
    });

    $('open-new-topic').addEventListener('click', () => {
        if (!topicForm.elements.author.value) topicForm.elements.author.value = name;
        if (!topicForm.elements.title.value) {
            topicForm.elements.category.value = category.value || 'GENERAL';
            topicForm.elements.siteId.value = site.value;
        }
        updateTopicFields();
        dialog.showModal();
    });
    $('close-new-topic').addEventListener('click', () => dialog.close());
    topicForm.elements.siteId.addEventListener('change', updateTopicFields);
    topicForm.elements.investigation.addEventListener('change', updateTopicFields);
    topicForm.addEventListener('submit', async event => {
        event.preventDefault();
        const button = topicForm.querySelector('button[type=submit]');
        button.disabled = true;
        status('topic-status', 'Публикуваме…');
        try {
            const created = await publish(urls.topics, topicForm);
            const selectedCategory = topicForm.elements.category.value;
            const selectedSite = topicForm.elements.siteId.value;
            if (category.value && category.value !== selectedCategory) category.value = '';
            if (site.value && site.value !== selectedSite) site.value = '';
            page = 0;
            topicForm.reset();
            status('topic-status');
            dialog.close();
            selectTopic(created.id, true);
        } catch (error) {
            status('topic-status', errorMessage(error), true);
        } finally {
            button.disabled = false;
        }
    });

    replyForm.addEventListener('submit', async event => {
        event.preventDefault();
        const state = current;
        const button = replyForm.querySelector('button[type=submit]');
        button.disabled = true;
        status('reply-status', 'Публикуваме…');
        try {
            await publish(urls.topics + '/' + state.id + '/posts', replyForm);
            if (state !== current) return;
            replyForm.reset();
            replyForm.elements.author.value = name;
            status('reply-status', 'Отговорът е публикуван.');
            state.forceBottom = true;
            refreshDiscussion(state);
            refreshList(true);
        } catch (error) {
            if (state === current) status('reply-status', errorMessage(error), true);
        } finally {
            if (state === current) button.disabled = false;
        }
    });

    $('older-posts').addEventListener('click', olderPosts);
    for (const filter of [site, category]) filter.addEventListener('change', () => {
        page = 0;
        refreshList();
    });
    $('previous-topics').addEventListener('click', () => { page--; refreshList(); });
    $('next-topics').addEventListener('click', () => { page++; refreshList(); });

    function refreshVisible() {
        if (document.hidden) return;
        refreshList(true);
        if (current) refreshDiscussion(current, true);
    }

    site.value = initialLink.searchParams.get('site') || '';
    if (site.selectedIndex < 0) site.selectedIndex = 0;
    const linkedTopic = Number(initialLink.searchParams.get('topic'));
    if (Number.isSafeInteger(linkedTopic) && linkedTopic > 0) selectTopic(linkedTopic, false);
    else refreshList();
    document.addEventListener('visibilitychange', refreshVisible);
    setInterval(refreshVisible, 5000);
})();
