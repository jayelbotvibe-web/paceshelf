/* PaceShelf — a personal learning library. */
(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const el = {
    video: $("#video"), stage: $("#video-stage"), grid: $("#course-grid"),
    library: $("#courses-view"), watch: $("#watch-view"), list: $("#watch-list"),
    seek: $("#seek-slider"), play: $("#play-pause-btn"), speed: $("#speed-btn"),
  };
  el.video=new window.PaceShelfOnline.Media(el.video);
  const youtube=window.PaceShelfYouTube;
  const thumbnail=v=>v.provider==="youtube"?'<span class="youtube-mark" aria-label="YouTube">YouTube</span>':`<img src="./api/thumb?path=${encodeURIComponent(v.id)}" alt="" loading="lazy" decoding="async"/>`;
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.7, 1.75, 2];
  const LOCAL_SAVE_INTERVAL_MS = 5000;
  let shelf = null, metadataRevision = "", catalog = [], metadataBlocked = false;
  const protocol = window.PaceShelfLibrary;
  let courses = [], currentCourse = null, currentVideo = null, playlist = [], playlistIndex = -1;
  let libraryFilter = "all", unwatchedOnly = false, loadingVideo = false, draggingSeek = false;
  let pendingSeek = null, lastSavedAt = 0, saveTimer = null, savingError = false;
  let courseRequest = 0, libraryReady = false;
  let saveChain = Promise.resolve(), saveSequence = 0, statusTimer = null, removing = false, connection = null;
  let speed = parseFloat(window.Android ? Android.getSpeed() : localStorage.getItem("coursePlayer.speed.v2") || "1");

  function fmtTime(value) {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const s = Math.floor(value), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return h ? `${h}:${String(m).padStart(2,"0")}:${String(s%60).padStart(2,"0")}` : `${m}:${String(s%60).padStart(2,"0")}`;
  }
  function isDone(v) { return v.done === true; }
  function percent(v) { return v.duration > 0 ? Math.max(0, Math.min(100, v.position / v.duration * 100)) : 0; }
  function courseCode(name) { const match = String(name).match(/^([A-Z]+\d+)/); return match ? match[1] : String(name).split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }
  function courseTitle(name) { return String(name).replace(/^[A-Z]+\d+\s*-\s*/,""); }
  function videosIn(c) { return c.sections.flatMap(section => section.videos); }
  function courseProgress(c) {
    const videos = videosIn(c), done = videos.filter(isDone).length, watched = videos.filter(v => v.position > 0).length;
    return { done, watched, total: videos.length, percent: videos.length ? Math.round(done / videos.length * 100) : 0 };
  }
  function findResumeVideo(c) {
    const videos = videosIn(c);
    const latest=protocol.newest(videos);
    if (latest && isDone(latest)) return videos[videos.indexOf(latest)+1] || latest;
    return latest || videos[0] || null;
  }
  async function api(path, options) {
    const response = await fetch(path, options);
    if (!response.ok) {
      let message = "Reconnect the SSD, then refresh your library.";
      try { message = (await response.json()).error || message; } catch (_) {}
      throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
  }
  function setTopbarH() {
    const height = $("#topbar").offsetHeight + $("#notice").offsetHeight;
    document.documentElement.style.setProperty("--topbar-h", height + "px");
  }
  function notice(message,kind="") {
    $("#notice").dataset.kind=kind;
    $("#notice-message").textContent = message || "";
    $("#notice").classList.toggle("hidden", !message);
    setTopbarH();
  }
  window.coursePlayerNotice = notice;

  function openSheet(id) {
    for (const dialog of $$("dialog[open]")) closeSheet(dialog);
    const dialog = $(id);
    dialog.classList.remove("hidden");
    dialog.showModal();
    if (id === "#options") api("./api/status").then(updateConnection).catch(() => {});
  }
  function closeSheet(dialog) { if(dialog.id==='youtube-sheet')resetYouTubePreview();dialog.close(); dialog.classList.add("hidden"); }
  function closeSheets() { for (const dialog of $$("dialog[open]")) closeSheet(dialog); }
  for (const dialog of $$("dialog")) {
    dialog.addEventListener("click", event => { if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeSheet(dialog);
    }});
    dialog.addEventListener("cancel", event => { event.preventDefault(); closeSheet(dialog); });
    dialog.querySelector("[data-close-sheet]").addEventListener("click", () => closeSheet(dialog));
  }

  function updateConnection(status) {
    libraryReady = status.ready;
    $("#drive-label").textContent = status.ready ? "Safely remove" : "Connect library";
    if(status.deviceLibrary){$("#drive-label").textContent="Library settings";$("#drive-status").setAttribute('aria-label','Library settings');}
    $("#drive-status").setAttribute("aria-label", status.deviceLibrary ? "Library settings" : status.ready ? "Safely remove SSD" : "Choose your course library");
    $("#drive-status").disabled = false;
    $("#watch-eject-btn").disabled = !status.ready;
    $("#eject-btn").disabled = !status.ready;
    $("#drive-status").classList.toggle("connected", status.ready);
    $("#folder-name").textContent = status.folder || "Your course library";
    $("#sync-status").textContent = status.sync;
    $("#library-save-status").textContent = status.ready
      ? status.shared ? "Available offline · Progress saved to your SSD" : "Available offline · Progress saved on this device"
      : "Your library is available offline";
    const previousShared=connection?.shared;
    connection = status;
    renderLibrarySaveStatus();
    const lastVerified = status.verifiedAt ? new Date(status.verifiedAt).toLocaleString() : "Not confirmed";
    $("#history-status").textContent = `${shelf?.all("resume").filter(r=>r.value).length || 0} saved positions · Last verified portable save: ${lastVerified}`;
    if(status.ready && status.mode!=="device" && !status.shared && status.syncError && previousShared!==false) notice("Portable save could not be verified. Progress is on this device only. Open Library settings for details.","sync");
    else if(status.shared && $("#notice").dataset.kind==="sync") notice("");
    const state = savingError ? "error" : status.syncError ? "local" : status.pending ? "pending" : status.shared ? "shared" : "local";
    const label = state === "error" ? "Save failed" : state === "pending" ? "Saving…" : status.shared ? "Saved to drive" : "This device only";
    $("#save-indicator").innerHTML = icon(state === "shared" ? "check" : "drive") + label;
    $("#save-indicator").dataset.state = state;
    $("#storage-mode").value=status.mode || "portable";
    $("#storage-mode option[value=portable]").disabled=!!status.deviceLibrary;
    $("#add-youtube-btn").disabled=!status.ready || metadataBlocked;
    for(const id of ['#watch-eject-btn','#eject-btn'])$(id).classList.toggle('hidden',!!status.deviceLibrary);
    $("#device-library-btn").classList.toggle('hidden',!window.Android || status.ready);
    if (!window.Android) {
      $("#folder-btn").classList.add("hidden");
      $("#setup-folder-btn").classList.add("hidden");

    }
  }
  async function loadLibrary() {
    // An unknown schema or incomplete refresh must never leave the old editor writable.
    metadataBlocked=true;
    const status = await api("./api/status");
    updateConnection(status);
    $("#setup").classList.toggle("hidden", status.ready);
    el.library.classList.toggle("hidden", !status.ready);
    if (!status.ready) {
      el.watch.classList.add("hidden");
      document.body.classList.remove("watch");
      $("#setup-message").textContent = status.removing
        ? "Drive activity is stopped. Unmount USB storage in My Files before unplugging. To continue watching instead, tap Reconnect SSD."
        : status.error || (status.selected
        ? "Reconnect your SSD to pick up where you left off. If your library has moved, choose its course folder again."
        : "Choose a folder of personal videos, or start a device-only library for YouTube.");
      $("#reconnect-btn").classList.toggle("hidden", !status.selected);
      setTopbarH(); return;
    }
    catalog = await api("./api/courses");
    const saved = await api("./api/library");
    metadataRevision = saved.revision;
    const states = [...saved.states];
    if (savingError && shelf && (!states.length || states[0].id === shelf.state.id)) states.push(shelf.state);
    shelf = new protocol.Library(protocol.merge(...states), saved.device);
    const canWrite=await claimWriter(shelf.state.id);
    if(!canWrite)notice("This library is being edited in another PaceShelf window. Close that window, then refresh to edit here.");
    if (!saved.blocked && canWrite) {
      shelf.reconcile(catalog);
      metadataBlocked=false;
      await persistLibrary();
    }
    courses = shelf.courses(catalog);
    renderLibrary(); updateStudy();
    if (metadataBlocked && saved.error) notice(saved.error);
    const savedSpeed = shelf.get("preference/playback")?.speed || Number(status.speed);
    if (SPEEDS.includes(savedSpeed)) { speed = savedSpeed; applySpeed(false); }
    if (metadataBlocked) return;
    if(Object.values(shelf.state.records).some(v=>v.length>1)){notice("Changes from different devices need your choice. Open Library settings → Review conflicts.","conflict");return;}
    notice(!courses.length ? "No videos found. Choose a folder containing videos or course subfolders."
      : status.syncError ? "Portable save could not be verified. Progress is on this device only. Open Library settings for details." : "", status.syncError ? "sync" : "");
  }

  function renderLibrary() {
    renderLibrarySaveStatus();
    const stats = courses.map(c => ({ course:c, progress:courseProgress(c) }));
    const total = stats.reduce((sum, item) => sum + item.progress.total, 0);
    $("#library-course-count").textContent = courses.length;
    $("#library-lesson-count").textContent = total.toLocaleString() + " lessons, ready when you are";
    $("#all-count").textContent = courses.length;
    $("#started-count").textContent = stats.filter(item => item.progress.watched > 0 && item.progress.done < item.progress.total).length;
    $("#completed-count").textContent = stats.filter(item => item.progress.total > 0 && item.progress.done === item.progress.total).length;
    $("#favorites-count").textContent = courses.filter(c => c.favorite).length;
    renderContinue(); renderCourseCards();
  }
  function renderLibrarySaveStatus(){
    if(!connection)return;
    const online=courses.some(c=>videosIn(c).some(v=>v.provider==='youtube'));
    $('#library-save-status').textContent=online
      ? (connection.shared?'Library metadata saved to drive':'Library metadata saved on this device')+' · YouTube requires internet'
      : connection.ready?(connection.shared?'Available offline · Progress saved to your SSD':'Available offline · Progress saved on this device'):'Your library is available offline';
  }
  function renderContinue() {
    const latest=protocol.newest(courses.flatMap(course=>videosIn(course).map(v=>({...v,course}))));
    const latestCourse=latest?.course;
    $("#continue-section").classList.toggle("hidden", !latestCourse);
    if (!latestCourse) { $("#continue-card").replaceChildren(); return; }
    const video = findResumeVideo(latestCourse), all = videosIn(latestCourse), progress = courseProgress(latestCourse);
    const resume = video.position > 0 && !isDone(video);
    $("#continue-card").innerHTML = `<button class="continue-card" aria-label="Continue ${esc(latestCourse.name)}">
      <span class="continue-info"><span class="continue-topline"><span class="course-pill">${esc(courseCode(latestCourse.name))}</span><span class="muted">${progress.percent}% complete</span></span>
      <h3>${esc(courseTitle(latestCourse.name))}</h3><p class="continue-lesson">Lesson ${all.indexOf(video)+1} of ${all.length} · ${esc(video.title)}</p>
      <span class="continue-bottom"><span class="continue-action">${icon("play")}${resume ? "Resume at " + fmtTime(video.position) : "Continue course"}</span><span class="continue-progress"><span style="width:${progress.percent}%"></span></span></span></span>
      <span class="continue-art">${thumbnail(video)}${icon("play")}</span></button>`;
    $("#continue-card button").addEventListener("click", () => openCourse(latestCourse.id));
  }
  function renderCourseCards() {
    const query = $("#course-search").value.trim().toLowerCase();
    $("#continue-section").classList.toggle("hidden", Boolean(query) || libraryFilter !== "all" || !$("#continue-card").firstElementChild);
    const filtered = courses.filter(c => {
      const p = courseProgress(c);
      return c.name.toLowerCase().includes(query) && (libraryFilter === "all"
        || libraryFilter === "started" && p.watched > 0 && p.done < p.total
        || libraryFilter === "completed" && p.total > 0 && p.done === p.total
        || libraryFilter === "favorites" && c.favorite);
    });
    $("#courses-heading").textContent = query ? "Search results" : libraryFilter === "started" ? "In progress" : libraryFilter === "completed" ? "Completed collections" : libraryFilter === "favorites" ? "Favorites" : "All collections";
    $("#courses-sub").textContent = `${filtered.length} ${filtered.length === 1 ? "collection" : "collections"}`;
    $("#course-empty").classList.toggle("hidden", filtered.length > 0);
    el.grid.innerHTML = filtered.map((course,index) => {
      const p = courseProgress(course), started = p.watched > 0, complete = p.done === p.total;
      return `<button class="course-card" data-course="${esc(course.id)}" aria-label="${esc(course.name)}, ${p.percent}% complete">
        <span class="course-art" style="--angle:${110+(index%4)*15}deg"><span class="course-art-label">${course.favorite ? "★ FAVORITE" : complete ? "COMPLETED" : started ? "IN PROGRESS" : "ON YOUR LEARNING PATH"}</span><span class="badge">${esc(courseCode(course.name))}</span>${icon("library")}</span>
        <span class="body"><span class="title">${esc(courseTitle(course.name))}</span><span class="meta"><span>${p.total.toLocaleString()} lessons</span><span class="pct">${p.percent}% complete</span></span><span class="pbar"><span class="fill" style="width:${p.percent}%"></span></span><span class="course-card-footer"><span>${complete ? "Review course" : started ? "Continue course" : "Start learning"}</span>${icon("arrow")}</span></span></button>`;
    }).join("");
    for (const card of el.grid.querySelectorAll(".course-card")) card.addEventListener("click", () => openCourse(card.dataset.course));
    for (const tab of $$(".filter-tab")) {
      const selected = tab.dataset.filter === libraryFilter;
      tab.classList.toggle("selected", selected); tab.setAttribute("aria-pressed", String(selected));
    }
  }
  function showCourses() {
    window.coursePlayerPause();
    if(el.video.online)el.video.release();
    $("#lesson-search").blur();
    if (!libraryReady) return;
    document.body.classList.remove("watch", "searching-lessons");
    el.watch.classList.add("hidden"); el.library.classList.remove("hidden");
    renderLibrary(); setTopbarH(); window.scrollTo(0,0);
  }
  async function openCourse(id) {
    const request = ++courseRequest;
    try {
      window.coursePlayerPause();
      const course = courses.find(c => c.id === id);
      if (!course) throw Error("Collection unavailable. Refresh your library.");
      if (request !== courseRequest) return;
      const index = courses.findIndex(item => item.id === id);
      if (index >= 0) courses[index] = course;
      currentCourse = course; playlist = videosIn(course); currentVideo = null; playlistIndex = -1;
      $("#watch-code").textContent = courseCode(course.name);
      $("#watch-title").textContent = courseTitle(course.name);
      $("#lesson-search").blur(); $("#lesson-search").value = ""; unwatchedOnly = false;
      $("#unwatched-btn").classList.remove("selected"); $("#unwatched-btn").setAttribute("aria-pressed","false");
      renderWatchList(); updateCourseSummary();
      document.body.classList.add("watch"); el.library.classList.add("hidden"); el.watch.classList.remove("hidden");
      setTopbarH(); window.scrollTo(0,0); playVideo(findResumeVideo(course)?.entryId);
    } catch (error) { notice(error.message); }
  }
  function updateCourseSummary() {
    if (!currentCourse) return;
    const p = courseProgress(currentCourse);
    $("#lesson-count").textContent = p.total;
    $("#watch-sub").textContent = `${p.done} OF ${p.total} COMPLETED`;
    $("#course-completion").style.setProperty("--completion",p.percent+"%");
    $("#course-completion span").textContent = p.percent+"%";
    $("#course-completion").setAttribute("aria-label",p.percent+" percent of course complete");
  }
  function lessonMeta(v) {
    return v.conflict ? "Choose resume position" : !v.available ? "Connect library to play" : isDone(v) ? icon("check") + "Completed" : v.position > 0 ? icon("clock") + "Resume at " + fmtTime(v.position) : "Ready to watch";
  }
  function renderWatchList() {
    let number = 0;
    el.list.innerHTML = currentCourse.sections.map(section => `<details class="watch-section" open><summary>${icon("chevron")}<span>${esc(!section.name || section.name === "." ? "Lessons" : section.name)}</span><small>${section.videos.length}</small></summary><div>${section.videos.map(video => {
      number++;
      return `<button class="watch-item" data-id="${esc(video.id)}" data-entry="${esc(video.entryId)}" data-search="${esc((video.title+" "+section.name+" "+number).toLowerCase())}" aria-label="Lesson ${number}: ${esc(video.title)}">
        <span class="wi-num">${String(number).padStart(2,"0")}</span><span class="wi-thumb">${thumbnail(video)}<span class="wi-progress" style="width:${percent(video)}%"></span></span>
        <span class="wi-info"><span class="wi-title">${esc(video.title)}</span><span class="wi-meta">${lessonMeta(video)}</span></span><span class="wi-check${isDone(video) ? "" : " hidden"}">${icon("check")}</span></button>`;
    }).join("")}</div></details>`).join("");
    for (const row of el.list.querySelectorAll(".watch-item")) {
      row.addEventListener("pointerdown", event => {
        // Keep the search layout steady until the tapped result is selected.
        if (document.activeElement === $("#lesson-search")) event.preventDefault();
      });
      row.addEventListener("click", () => { $("#lesson-search").blur(); playVideo(row.dataset.entry); });
    }
  }
  function filterLessons() {
    const query = $("#lesson-search").value.trim().toLowerCase();
    const byId = new Map(playlist.map(v => [v.entryId,v]));
    let visible = 0;
    for (const section of el.list.querySelectorAll(".watch-section")) {
      let matches = 0;
      for (const row of section.querySelectorAll(".watch-item")) {
        const show = row.dataset.search.includes(query) && (!unwatchedOnly || !isDone(byId.get(row.dataset.entry)) || row.dataset.entry === currentVideo?.entryId);
        row.classList.toggle("hidden", !show); if (show) matches++;
      }
      section.classList.toggle("hidden", !matches);
      if (query) section.open = true;
      visible += matches;
    }
    $("#lesson-empty").classList.toggle("hidden", visible > 0);
  }
  function itemFor(id) { return [...el.list.querySelectorAll(".watch-item")].find(item => item.dataset.entry === id); }
  function refreshItem(video) {
    const row = itemFor(video.entryId);
    if (row) {
      row.querySelector(".wi-meta").innerHTML = lessonMeta(video);
      row.querySelector(".wi-check").classList.toggle("hidden", !isDone(video));
      row.querySelector(".wi-progress").style.width = percent(video)+"%";
    }
    updateCourseSummary();
  }
  function revealCurrent() {
    const row = itemFor(currentVideo?.entryId);
    if (!row || row.classList.contains("hidden")) return;
    row.closest("details").open = true;
    requestAnimationFrame(() => {
      const bounds = el.list.getBoundingClientRect(), item = row.getBoundingClientRect();
      const delta = item.top < bounds.top ? item.top - bounds.top - 8 : item.bottom > bounds.bottom ? item.bottom - bounds.bottom + 8 : 0;
      if (delta) el.list.scrollBy({top:delta, behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    });
  }
  function playVideo(id) {
    if(metadataBlocked){notice("This library is read-only. Resolve its recovery or open-window warning before continuing.");return;}
    const video = playlist.find(v => v.entryId === id) || playlist.find(v => v.id === id);
    if (!video) return;
    if (video.conflict) { showConflicts(); return; }
    if (!video.available) { notice("This lesson is unavailable. Reconnect its original library folder and refresh."); return; }
    saveProgress(true); loadingVideo = true; el.video.pause();
    currentVideo = video; playlistIndex = playlist.indexOf(video);
    const lessonQuery = $("#lesson-search").value.trim().toLowerCase();
    if (lessonQuery && !(video.title+" "+video.section+" "+(playlistIndex+1)).toLowerCase().includes(lessonQuery)) $("#lesson-search").value = "";
    $("#player-meta").textContent = video.title;
    $("#lesson-eyebrow").textContent = `NOW PLAYING · LESSON ${playlistIndex+1}`;
    $("#current-section").textContent = video.section && video.section !== "." ? video.section : courseCode(currentCourse.name);
    const atEnd=video.duration>0 && video.duration-video.position<=Math.min(15,video.duration*.05);
    pendingSeek = video.position > 0 && !isDone(video) && !atEnd ? video.position : 0;
    draggingSeek = false; el.seek.disabled = true; el.seek.value = 0; el.seek.style.setProperty("--seek","0%");
    $("#elapsed-time").textContent = fmtTime(pendingSeek); $("#duration-time").textContent = fmtTime(video.duration);
    $("#video-loading").classList.remove("hidden");
    $("#online-details").classList.toggle('hidden',video.provider!=="youtube");
    $("#source-links").replaceChildren();
    for(const ref of currentCourse.references||[]){
      const b=document.createElement('button');b.className='text-btn';b.textContent='Open source playlist';b.onclick=()=>openYouTubeURL('playlist',ref.playlistId);$('#source-links').append(b);
      const refresh=document.createElement('button');refresh.className='text-btn';refresh.textContent='Review playlist updates';refresh.onclick=()=>{$('#add-youtube-btn').click();$('#youtube-input').value=youtube.playlistURL(ref.playlistId);};$('#source-links').append(refresh);
    }
    if(video.provider==="youtube"){
      el.video.useYouTube(video,pendingSeek);loadingVideo=false;el.seek.disabled=true;
      $("#video-loading").classList.add('hidden');updateTimeline();updatePlaybackState();
    }else{
      el.video.src = "./api/video?path=" + encodeURIComponent(video.id); el.video.load(); el.video.playbackRate = speed;
      el.video.play().catch(() => updatePlaybackState());
    }
    for (const item of el.list.querySelectorAll(".watch-item")) {
      const selected = item.dataset.entry === video.entryId;
      item.classList.toggle("current",selected);
      if (selected) item.setAttribute("aria-current","true"); else item.removeAttribute("aria-current");
    }
    updatePlayerNav(); filterLessons(); revealCurrent(); updateStudy();
  }
  function updatePlayerNav() {
    $("#video-pos").textContent = playlist.length ? `${playlistIndex+1} / ${playlist.length}` : "";
    $("#prev-btn").disabled = playlistIndex <= 0;
    $("#next-btn").disabled = playlistIndex < 0 || playlistIndex >= playlist.length-1;
    const next = playlist[playlistIndex+1];
    $("#up-next").classList.toggle("hidden",!next);
    if (next) { $("#up-next-title").textContent = next.title; $("#next-btn").title = "Next: " + next.title; }
  }
  function nextVideo() { if (playlistIndex < playlist.length-1) playVideo(playlist[playlistIndex+1].entryId); }
  function prevVideo() { if (playlistIndex > 0) playVideo(playlist[playlistIndex-1].entryId); }
  function updateTimeline() {
    if (!draggingSeek) {
      const duration = el.video.duration;
      el.seek.value = Number.isFinite(duration) && duration > 0 ? Math.round(el.video.currentTime / duration * 1000) : 0;
      el.seek.style.setProperty("--seek",el.seek.value / 10 + "%");
      el.seek.setAttribute("aria-valuetext",fmtTime(el.video.currentTime)+" of "+fmtTime(duration));
      $("#elapsed-time").textContent = fmtTime(el.video.currentTime);
    }
    $("#duration-time").textContent = fmtTime(el.video.duration);
  }
  function updatePlaybackState() {
    const playing = !el.video.paused && !el.video.ended;
    el.stage.classList.toggle("is-playing",playing);
    el.play.innerHTML = icon(playing ? "pause" : "play");
    el.play.setAttribute("aria-label",playing ? "Pause video" : "Play video");
    $("#big-play-btn").setAttribute("aria-label",playing ? "Pause lesson" : "Play lesson");
    if (window.Android) Android.keepAwake(playing);
  }
  function togglePlayback() {
    if (!currentVideo) return;
    if (el.video.paused || el.video.ended) el.video.play().catch(() => notice("Tap play again after reconnecting the SSD."));
    else el.video.pause();
  }
  function applySpeed(persist = true) {
    if (!SPEEDS.includes(speed)) speed = 1;
    el.video.playbackRate = speed;
    el.speed.innerHTML = speed + "× <span>speed</span>";
    el.speed.setAttribute("aria-label","Playback speed: "+speed+" times");
    localStorage.setItem("coursePlayer.speed.v2",String(speed));
    if (persist && libraryReady) {
      if (window.Android) Android.setSpeed(String(speed));
      shelf.put("preference/playback", {...shelf.get("preference/playback"),speed}); persistLibrary().catch(() => {});
    }
    for (const option of $$(".speed-option")) {
      const selected = Number(option.dataset.speed) === speed;
      option.classList.toggle("selected",selected); option.setAttribute("aria-pressed",String(selected));
      option.disabled=el.video.online&&el.video.rates.length>0&&!el.video.rates.includes(Number(option.dataset.speed));
    }
  }
  function changeSpeed(direction) {
    speed = SPEEDS[Math.max(0,Math.min(SPEEDS.length-1,SPEEDS.indexOf(speed)+direction))]; applySpeed();
  }
  $("#speed-options").innerHTML = SPEEDS.map(value => `<button class="speed-option" data-speed="${value}" aria-pressed="false">${value}×${value === 1 ? "<span>Normal</span>" : ""}</button>`).join("");
  for (const option of $$(".speed-option")) option.addEventListener("click", () => {
    speed = Number(option.dataset.speed); applySpeed(); closeSheet($("#speed-sheet"));
  });

  function refreshSaveStatus(delay = 750) {
    clearTimeout(statusTimer);
    if (!removing && !document.hidden) statusTimer = setTimeout(() => api("./api/status").then(status => {
      updateConnection(status);
      if (status.pending) refreshSaveStatus(15000);
    }).catch(() => {}),delay);
  }
  function saveProgress(force) {
    if (removing || loadingVideo || el.video.foreign || !currentVideo || !Number.isFinite(el.video.duration) || el.video.duration <= 0) return saveChain;
    const now = Date.now();
    if (!force && now-lastSavedAt < LOCAL_SAVE_INTERVAL_MS) return saveChain;
    const position = el.video.currentTime, duration = el.video.duration;
    if (position === currentVideo.position && duration === currentVideo.duration && !savingError) return saveChain;
    lastSavedAt = now;
    currentVideo.position = position; currentVideo.duration = duration; currentVideo.updatedAt = new Date().toISOString();
    if (metadataBlocked || !shelf) { notice("This library requires recovery before editing."); return saveChain; }
    shelf.put("resume/"+currentVideo.mediaId,{position:Math.min(position,duration),duration,updatedAt:currentVideo.updatedAt,entryId:currentVideo.entryId,collectionId:currentCourse.id});
    const revision=shelf.variants("resume/"+currentVideo.mediaId)[0];
    for(const course of courses)for(const v of videosIn(course))if(v.mediaId===currentVideo.mediaId){
      v.position=position;v.duration=duration;v.updatedAt=currentVideo.updatedAt;v.resumeRevision=revision;v.active=v.entryId===currentVideo.entryId && course.id===currentCourse.id;
    }
    persistLibrary().catch(() => {});
    refreshItem(currentVideo);
    return saveChain;
  }
  // Save a short first checkpoint and deliberate seeks promptly; batch normal playback.
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveProgress(true),1000); }
  function flushProgress() {
    if (window.Android && Android.flushProgress) {
      clearTimeout(statusTimer);
      try { updateConnection(JSON.parse(Android.flushProgress())); } catch (_) {}
      return Promise.resolve();
    }
    return saveChain.catch(() => {}).then(() => api("./api/flush", {method:"POST",keepalive:true})).then(updateConnection).catch(() => {});
  }
  window.coursePlayerPause = () => { saveProgress(true); el.video.pause(); updatePlaybackState(); if (!removing) flushProgress(); };
  window.coursePlayerSuspend = () => {
    window.coursePlayerPause();
    clearTimeout(saveTimer); clearTimeout(statusTimer);
    // Cancel buffered USB reads as well as playback while Android is in the background.
    el.video.removeAttribute("src"); el.video.load();
  };
  window.coursePlayerPrepareRemoval = () => {
    closeSheets(); window.coursePlayerPause();
    if(savingError){notice("The latest save failed. Reconnect and retry or export a backup before removing the drive.");return false;}
    removing = true; clearTimeout(statusTimer); clearTimeout(saveTimer); currentVideo = null; loadingVideo = false;
    el.video.removeAttribute("src"); el.video.load();
    for (const selector of ["#drive-status", "#watch-eject-btn", "#eject-btn"]) $(selector).disabled = true;
    notice("Saving your progress before removing the SSD…");
    return true;
  };
  window.coursePlayerRemovalPrepared = async (localSaved, ssdSaved) => {
    await loadLibrary();
    notice(ssdSaved ? "Progress saved. Finish with Unmount in My Files before unplugging."
      : localSaved ? "Progress is saved on this device. The SSD save could not be verified. Reconnect and retry."
      : "The save could not be confirmed. Reconnect the SSD and retry.");
    setTopbarH();
  };
  window.coursePlayerBack = () => {
    const dialog = $("dialog[open]");
    if (dialog) { closeSheet(dialog); return true; }
    window.coursePlayerPause();
    if (!el.watch.classList.contains("hidden")) { showCourses(); return true; }
    return false;
  };
  window.coursePlayerRefresh = async () => {
    removing = false; window.coursePlayerPause(); currentVideo = null;
    if (window.Android) { speed = parseFloat(Android.getSpeed()); applySpeed(false); }
    try{await loadLibrary();showCourses();}
    catch(error){notice(error.message);updateStudy();throw error;}
  };
  async function refreshLibrary() {
    closeSheets(); window.coursePlayerPause(); notice("Connecting to your library…");
    try { await saveChain; await api("./api/refresh"); await window.coursePlayerRefresh(); }
    catch (error) { await loadLibrary().catch(() => {}); notice(error.message); }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $("#player-shell").requestFullscreen();
    } catch (_) { notice("Full screen is unavailable right now. Rotate your device for a wider view."); }
  }

  el.video.addEventListener("loadedmetadata", () => {
    el.video.playbackRate = speed; el.seek.disabled = false;
    const resume = pendingSeek; pendingSeek = null;
    if (resume > 0 && (!el.video.online || Math.abs(el.video.currentTime-resume)>2)) {
      try { el.video.currentTime = Math.min(resume,el.video.duration); }
      catch (_) { /* A provider may not seek until playback starts. */ }
    }
    loadingVideo = false;
    updateTimeline(); updateStudy(); scheduleSave();
  });
  el.video.addEventListener("seeked", () => { loadingVideo = false; updateTimeline(); scheduleSave(); });
  el.video.addEventListener("timeupdate", () => { updateTimeline(); saveProgress(false); });
  el.video.addEventListener("play", updatePlaybackState);
  el.video.addEventListener("playing", () => { $("#video-loading").classList.add("hidden"); updatePlaybackState(); });
  el.video.addEventListener("pause", () => { saveProgress(true); updatePlaybackState(); if (!removing) flushProgress(); });
  el.video.addEventListener("waiting", () => { if (!el.video.paused) $("#video-loading").classList.remove("hidden"); });
  el.video.addEventListener("canplay", () => $("#video-loading").classList.add("hidden"));
  el.video.addEventListener("ended", () => {
    saveProgress(true);setCompletion(true);updatePlaybackState();
    const r=el.stage.getBoundingClientRect(),visible=!document.hidden && (window.Android || Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0))>=r.height*.5);
    if(shelf?.get("preference/playback")?.autoNext!==false && (!el.video.online||visible))nextVideo();
  });
  el.video.addEventListener("error", () => {
    loadingVideo = false; $("#video-loading").classList.add("hidden"); updatePlaybackState();
    notice(el.video.online?el.video.errorMessage || "YouTube could not play this video. Check your connection or use Open original video.":"This lesson couldn’t be played. Check the SSD connection, or try another lesson.");
  });
  el.video.addEventListener('sourcechange',()=>{
    el.seek.disabled=el.video.foreign||!Number.isFinite(el.video.duration);
    updateTimeline();updateStudy();
    notice(el.video.foreign?'YouTube opened a different video. Progress tracking for this lesson is paused.':'Back to this lesson. Progress tracking resumed.');
  });
  el.video.addEventListener('ratechange',()=>{
    if(!el.video.online || !Number.isFinite(el.video.duration) || el.video.duration<=0)return;
    const rate=el.video.playbackRate;
    if(SPEEDS.includes(rate)&&speed!==rate){
      speed=rate;
      if(shelf&&!metadataBlocked){shelf.put('preference/playback',{...shelf.get('preference/playback'),speed});persistLibrary().catch(()=>{});}
    }
    el.speed.innerHTML=rate+'× <span>speed</span>';
    el.speed.setAttribute('aria-label','Playback speed: '+rate+' times');
    for(const option of $$('.speed-option')){option.disabled=el.video.rates.length>0&&!el.video.rates.includes(Number(option.dataset.speed));option.classList.toggle('selected',Number(option.dataset.speed)===rate);}
    updateStudy();
  });
  el.seek.addEventListener("input", () => {
    draggingSeek = true; el.seek.style.setProperty("--seek",el.seek.value/10+"%");
    $("#elapsed-time").textContent = fmtTime(el.video.duration * el.seek.value / 1000);
  });
  el.seek.addEventListener("change", () => {
    if (Number.isFinite(el.video.duration)) el.video.currentTime = el.video.duration * el.seek.value / 1000;
    draggingSeek = false; updateTimeline();
  });
  el.seek.addEventListener("blur", () => { draggingSeek = false; updateTimeline(); });
  document.addEventListener("fullscreenchange", () => {
    const full = Boolean(document.fullscreenElement);
    $("#fullscreen-btn").innerHTML = icon(full ? "minimize" : "fullscreen");
    $("#fullscreen-btn").setAttribute("aria-label",full ? "Exit full screen" : "Enter full screen");
  });

  $("#play-pause-btn").addEventListener("click",togglePlayback);
  $("#big-play-btn").addEventListener("click",togglePlayback);
  $("#online-open").addEventListener('click',()=>el.video.open().catch(e=>notice(e.message)));
  $("#open-youtube-link").addEventListener('click',()=>{if(currentVideo?.videoId)openYouTubeURL('video',currentVideo.videoId);});
  el.video.addEventListener("click",togglePlayback);
  $("#fullscreen-btn").addEventListener("click",toggleFullscreen);
  $("#prev-btn").addEventListener("click",prevVideo);
  $("#next-btn").addEventListener("click",nextVideo);
  $("#up-next").addEventListener("click",nextVideo);
  $("#rewind-btn").addEventListener("click", () => { if (currentVideo) el.video.currentTime = Math.max(0,el.video.currentTime-10); });
  $("#forward-btn").addEventListener("click", () => { if (currentVideo && Number.isFinite(el.video.duration)) el.video.currentTime = Math.min(el.video.duration,el.video.currentTime+10); });
  el.speed.addEventListener("click", () => openSheet("#speed-sheet"));
  $("#home-btn").addEventListener("click",showCourses);
  $("#back-btn").addEventListener("click",showCourses);
  for (const selector of ["#menu-btn"]) $(selector).addEventListener("click", () => openSheet("#options"));
  async function safelyRemove() {
    closeSheets();
    if (window.Android) { Android.eject(); return; }
    window.coursePlayerPause();
    try{await saveChain;}catch(_){notice("The latest save failed. Reconnect and retry or export a backup before removing the drive.");return;}
    if(!window.coursePlayerPrepareRemoval())return;
    await saveChain;
    try {
      const result = await api("./api/eject",{method:"POST"});
      el.watch.classList.add("hidden"); el.library.classList.add("hidden");
      document.body.classList.remove("watch"); $("#setup").classList.remove("hidden");
      $("#reconnect-btn").classList.add("hidden");
      $("#setup-message").textContent = result.unmounted
        ? "Progress saved and USB storage unmounted by Ubuntu. You can unplug the SSD. Open Start PaceShelf again after reconnecting."
        : result.ssdSaved
        ? "Progress saved. Finish with Eject beside your drive in Ubuntu Files before unplugging. Close other apps or terminals using the drive if it is busy. Open Start PaceShelf again to reconnect."
        : "SSD save failed. Your progress is kept on this laptop. Reconnect the drive and open Start PaceShelf again before switching devices.";
      notice(result.unmounted ? "SSD saved and safely unmounted. You can unplug it." : result.ssdSaved ? "Saved to SSD. Finish with Eject in Ubuntu Files." : "SSD save failed. Progress is saved on this laptop only.");
    } catch (_) { removing = false; notice("The SSD save could not be verified. Reconnect and retry before unplugging."); }
  }
  $("#drive-status").addEventListener("click", () => libraryReady && !connection?.deviceLibrary ? safelyRemove() : openSheet("#options"));
  $("#watch-eject-btn").addEventListener("click", safelyRemove);
  for (const selector of ["#folder-btn","#setup-folder-btn"]) $(selector).addEventListener("click", () => {
    closeSheets(); window.coursePlayerPause();
    if (window.Android) Android.chooseFolder(); else notice("Close this window and use the PaceShelf launcher to select a different folder.");
  });
  $("#import-btn").addEventListener("click", () => { closeSheets(); window.coursePlayerPause(); if (window.Android) Android.importProgress(); else $("#backup-file").click(); });
  $("#save-indicator").addEventListener("click", () => openSheet("#options"));
  $("#save-indicator").addEventListener("keydown", e => { if(e.key === "Enter" || e.key === " ") {e.preventDefault();openSheet("#options");} });
  $("#export-btn").addEventListener("click", async () => {
    closeSheets(); window.coursePlayerPause(); await saveChain;
    if(window.Android) Android.exportProgress();
    else downloadBackup();
  });
  $("#eject-btn").addEventListener("click", safelyRemove);
  $("#refresh-btn").addEventListener("click",refreshLibrary);
  $("#reconnect-btn").addEventListener("click",refreshLibrary);
  $("#dismiss-notice").addEventListener("click", () => notice(""));
  $("#course-search").addEventListener("input",renderCourseCards);
  for (const tab of $$(".filter-tab")) tab.addEventListener("click", () => { libraryFilter = tab.dataset.filter; renderCourseCards(); });
  $("#clear-filters").addEventListener("click", () => { libraryFilter = "all"; $("#course-search").value = ""; renderCourseCards(); });
  $("#lesson-search").addEventListener("input",filterLessons);
  $("#lesson-search").addEventListener("focus", () => document.body.classList.add("searching-lessons"));
  $("#lesson-search").addEventListener("blur", () => document.body.classList.remove("searching-lessons"));
  $("#unwatched-btn").addEventListener("click", () => {
    unwatchedOnly = !unwatchedOnly; $("#unwatched-btn").classList.toggle("selected",unwatchedOnly);
    $("#unwatched-btn").setAttribute("aria-pressed",String(unwatchedOnly)); filterLessons();
  });
  document.addEventListener("keydown", event => {
    if (el.watch.classList.contains("hidden") || $("dialog[open]") || event.target.matches("input,textarea,[contenteditable=true]")) return;
    switch (event.key.toLowerCase()) {
      case " ": case "k": event.preventDefault(); togglePlayback(); break;
      case "arrowleft": case "j": event.preventDefault(); $("#rewind-btn").click(); break;
      case "arrowright": case "l": event.preventDefault(); $("#forward-btn").click(); break;
      case "arrowup": event.preventDefault(); el.video.volume = Math.min(1,el.video.volume+.1); break;
      case "arrowdown": event.preventDefault(); el.video.volume = Math.max(0,el.video.volume-.1); break;
      case "f": event.preventDefault(); toggleFullscreen(); break;
      case "m": event.preventDefault(); el.video.muted = !el.video.muted; break;
      case "p": event.preventDefault(); prevVideo(); break;
      case "n": event.preventDefault(); nextVideo(); break;
      case ",": case "<": event.preventDefault(); changeSpeed(-1); break;
      case ".": case ">": event.preventDefault(); changeSpeed(1); break;
    }
  });
  // Persist the entire generation before reporting success. Android's synchronous
  // bridge checkpoints app-private storage before a lifecycle callback returns.
  function persistLibrary(adopt=false) {
    if (!shelf || metadataBlocked) return Promise.reject(Error("Library is read-only until recovery is complete."));
    const payload=JSON.stringify(shelf.state);
    $("#save-indicator").textContent="Saving…";$("#save-indicator").dataset.state="pending";
    const failed=error=>{savingError=true;$("#save-indicator").textContent="Save failed";$("#save-indicator").dataset.state="error";notice(error.message || "Library save failed. Keep this window open.");throw error;};
    if (window.Android) {
      try {
        const result=JSON.parse(Android.saveLibrary(JSON.stringify({payload,expected:metadataRevision,adopt})));
        if(result.error)throw Error(result.error);
        metadataRevision=result.revision;if(result.device)shelf.device=result.device;savingError=false;refreshSaveStatus();return Promise.resolve();
      }catch(error){try{failed(error);}catch(e){return Promise.reject(e);}}
    }
    saveChain=saveChain.catch(()=>{}).then(()=>api("./api/library",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payload,expected:metadataRevision,adopt}),keepalive:payload.length<60000}))
      .then(result=>{metadataRevision=result.revision;if(result.device)shelf.device=result.device;savingError=false;refreshSaveStatus();}).catch(failed);
    return saveChain;
  }
  let undoCompletion=null,editDraft=null,editBase="",editKey="",writerId=null,libraryWriter=false,releaseWriter=null;
  async function claimWriter(id) {
    if(writerId===id && libraryWriter)return true;
    if(releaseWriter){releaseWriter();releaseWriter=null;}writerId=id;
    if(!navigator.locks){libraryWriter=true;return true;} // The backend still enforces compare-and-swap.
    return new Promise(resolve=>{
      navigator.locks.request("paceshelf-library-"+id,{ifAvailable:true},async lock=>{
        libraryWriter=!!lock;resolve(!!lock);
        if(lock)await new Promise(done=>{releaseWriter=done;});
      }).catch(()=>resolve(false));
    });
  }
  function updateStudy() {
    const selected=!!currentVideo;
    $("#complete-btn").disabled=!selected || metadataBlocked;
    $("#bookmark-btn").disabled=!selected || metadataBlocked || el.video.foreign || (el.video.online&&!Number.isFinite(el.video.duration));
    $("#complete-btn").textContent=currentVideo?.done?"Mark incomplete":"Mark complete";
    $("#complete-btn").setAttribute("aria-pressed",String(currentVideo?.done===true));
    $("#auto-next").checked=shelf?.get("preference/playback")?.autoNext!==false;
    const conflicts=shelf?Object.values(shelf.state.records).filter(v=>v.length>1).length:0;
    $("#conflicts-btn").textContent=`Review conflicts${conflicts?" ("+conflicts+")":""}`;
    $("#conflicts-btn").disabled=!conflicts;
    const bookmarks=shelf?.all("bookmark").filter(r=>r.value && (!currentVideo || r.value.mediaId===currentVideo.mediaId)) || [];
    $("#bookmark-list").innerHTML=bookmarks.length?bookmarks.map(r=>`<div class="bookmark-row"><button data-jump="${esc(r.key)}"><strong>${esc(r.value.title || "Bookmark")}</strong><span>${fmtTime(r.value.position)}</span></button><button class="icon-btn" data-delete="${esc(r.key)}" aria-label="Delete bookmark ${esc(r.value.title)}">${icon("close")}</button></div>`).join(""):"<p class='muted'>Save a moment to come back to. Bookmarks for this lesson appear here.</p>";
    for(const b of $$("[data-jump]"))b.onclick=()=>{
      const mark=shelf.get(b.dataset.jump),c=courses.find(c=>videosIn(c).some(v=>v.mediaId===mark.mediaId));
      const v=c && videosIn(c).find(v=>v.mediaId===mark.mediaId);
      if(!v?.available){notice("Connect the library that contains this bookmark's lesson.");return;}
      if(currentVideo?.mediaId===mark.mediaId){el.video.currentTime=mark.position;return;}
      openCourse(c.id).then(()=>{playVideo(v.id);pendingSeek=mark.position;});
    };
    for(const b of $$("[data-delete]"))b.onclick=()=>{shelf.put(b.dataset.delete,null);persistLibrary().then(updateStudy).catch(()=>{});};
  }
  function rebuildCourses() {
    courses=shelf.courses(catalog);
    if(currentCourse){currentCourse=courses.find(c=>c.id===currentCourse.id)||null;playlist=currentCourse?videosIn(currentCourse):[];
      if(currentVideo)currentVideo=playlist.find(v=>v.entryId===currentVideo.entryId)||null;
      if(currentCourse){
        $("#watch-title").textContent=currentCourse.name;renderWatchList();updateCourseSummary();
        playlistIndex=currentVideo?playlist.findIndex(v=>v.entryId===currentVideo.entryId):-1;
        for(const row of el.list.querySelectorAll(".watch-item")){const selected=row.dataset.entry===currentVideo?.entryId;row.classList.toggle("current",selected);if(selected)row.setAttribute("aria-current","true");}
        if(currentVideo){$("#player-meta").textContent=currentVideo.title;$("#current-section").textContent=currentVideo.section;$("#lesson-eyebrow").textContent=`NOW PLAYING · LESSON ${playlistIndex+1}`;}
        updatePlayerNav();filterLessons();
      }else{currentVideo=null;playlistIndex=-1;el.video.removeAttribute("src");el.video.load();el.list.replaceChildren();el.watch.classList.add("hidden");el.library.classList.remove("hidden");document.body.classList.remove("watch");}}
    renderLibrary();updateStudy();
  }
  function setCompletion(done) {
    if(!currentVideo || metadataBlocked || !shelf)return;
    const completedVideo=currentVideo;
    undoCompletion={key:"completion/"+currentVideo.entryId,value:shelf.get("completion/"+currentVideo.entryId)};
    shelf.put(undoCompletion.key,{done});currentVideo.done=done;
    persistLibrary().then(()=>{refreshItem(completedVideo);updateStudy();$("#undo-completion").classList.remove("hidden");}).catch(()=>{});
  }
  $("#complete-btn").onclick=()=>setCompletion(!currentVideo.done);
  $("#undo-completion").onclick=()=>{
    if(!undoCompletion)return;shelf.put(undoCompletion.key,undoCompletion.value);undoCompletion=null;
    persistLibrary().then(()=>{rebuildCourses();$("#undo-completion").classList.add("hidden");}).catch(()=>{});
  };
  $("#bookmark-btn").onclick=()=>{
    if(!currentVideo || metadataBlocked || !Number.isFinite(el.video.currentTime))return;
    shelf.put("bookmark/"+protocol.uuid(),{mediaId:currentVideo.mediaId,position:el.video.currentTime,title:currentVideo.title});
    persistLibrary().then(()=>{updateStudy();notice("Bookmark saved at "+fmtTime(el.video.currentTime)+".");}).catch(()=>{});
  };
  $("#auto-next").onchange=()=>{
    if(!shelf || metadataBlocked)return;
    shelf.put("preference/playback",{...shelf.get("preference/playback"),autoNext:$("#auto-next").checked});persistLibrary().catch(()=>{});
  };
  $("#storage-mode").onchange=async()=>{
    const mode=$("#storage-mode").value;
    window.coursePlayerPause();await saveChain.catch(()=>{});
    try{
      let status;
      if(window.Android){status=JSON.parse(Android.setStorageMode(mode));if(status.error)throw Error(status.error);}
      else status=await api("./api/mode",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode})});
      updateConnection(status);notice(status.sync);
    }catch(error){notice(error.message);}
  };
  function showConflicts() {
    window.coursePlayerPause();const list=$("#conflict-list");list.replaceChildren();
    for(const [key,versions] of Object.entries(shelf?.state.records || {}))if(versions.length>1){
      const group=document.createElement("section"),heading=document.createElement("h3");heading.textContent=key.split("/")[0]+" conflict";group.append(heading);
      const text=document.createElement("p");text.textContent="These changes were made independently. Choose the one you want to keep.";group.append(text);
      versions.forEach((v,index)=>{const b=document.createElement("button");b.className="setting-row";
        b.textContent=v.value===null?"Keep deletion":key.startsWith("resume/")?"Resume at "+fmtTime(v.value.position)+" of "+fmtTime(v.value.duration):key.startsWith("completion/")?(v.value.done?"Keep completed":"Keep incomplete"):v.value.title || "Keep revision "+(index+1);
        b.onclick=async()=>{shelf.resolve(key,index);try{await persistLibrary();rebuildCourses();showConflicts();}catch(_){}};group.append(b);});
      list.append(group);
    }
    if(!list.children.length)list.textContent="All changes have been resolved.";
    openSheet("#conflict-sheet");
  }
  $("#conflicts-btn").onclick=showConflicts;
  function drawEditor() {
    $("#edit-entries").innerHTML=editDraft.entries.map((entry,index)=>`<div class="edit-entry"><span class="muted">${index+1}</span><label>Lesson title<input data-entry="${index}" data-field="title" maxlength="500" value="${esc(entry.title)}"/></label><label>Section<input data-entry="${index}" data-field="section" maxlength="2000" value="${esc(entry.section)}"/></label><div><button type="button" class="icon-btn" data-move="${index}" data-direction="-1" ${index===0?"disabled":""} aria-label="Move lesson ${index+1} earlier">↑</button><button type="button" class="icon-btn" data-move="${index}" data-direction="1" ${index===editDraft.entries.length-1?"disabled":""} aria-label="Move lesson ${index+1} later">↓</button></div></div>`).join("");
    for(const input of $$("[data-entry]"))input.oninput=()=>{editDraft.entries[Number(input.dataset.entry)][input.dataset.field]=input.value;};
    for(const button of $$("[data-move]"))button.onclick=()=>{const i=Number(button.dataset.move),j=i+Number(button.dataset.direction);[editDraft.entries[i],editDraft.entries[j]]=[editDraft.entries[j],editDraft.entries[i]];drawEditor();};
  }
  $("#edit-collection-btn").onclick=()=>{
    if(!currentCourse || metadataBlocked)return;
    editKey="collection/"+currentCourse.id;editBase=JSON.stringify(shelf.variants(editKey));
    editDraft=JSON.parse(JSON.stringify(shelf.get(editKey)));
    $("#collection-title").value=editDraft.title;$("#collection-favorite").checked=editDraft.favorite===true;drawEditor();openSheet("#collection-sheet");
  };
  $("#collection-form").onsubmit=async event=>{
    event.preventDefault();
    if(metadataBlocked || JSON.stringify(shelf.variants(editKey))!==editBase){notice("This collection changed while you were editing. Review the latest changes before reopening the editor.");return;}
    editDraft.title=$("#collection-title").value.trim();editDraft.favorite=$("#collection-favorite").checked;
    if(!editDraft.title)return;
    shelf.put(editKey,editDraft);
    try{await persistLibrary();closeSheets();rebuildCourses();notice("Collection updated. Your original files stay in their folders.");}catch(_){}
  };
  function downloadBackup() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(shelf.state,null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download="paceshelf-library.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notice("Library backup exported. It contains metadata only; videos are not included.");
  }
  let pendingImport=null;
  let youtubeInspection=null,youtubeDraft=null;
  const externalPages={terms:'https://www.youtube.com/t/terms',privacy:'https://policies.google.com/privacy',paceshelf:'https://github.com/jayelbotvibe-web/paceshelf/blob/main/docs/PRIVACY.md'};
  function openYouTubeURL(kind,id){
    const url=kind==='video'?youtube.videoURL(id):kind==='playlist'?youtube.playlistURL(id):externalPages[kind];
    if(!url)return;
    window.coursePlayerPause();
    if(window.Android)Android.openYouTubeLink(kind,id||'');else window.open(url,'_blank','noopener');
  }
  function resetYouTubePreview(){
    youtubeInspection?.close();youtubeInspection=null;youtubeDraft=null;
    $('#youtube-provider-preview').replaceChildren();$('#youtube-provider-preview').classList.add('hidden');
    $('#youtube-confirm').classList.add('hidden');$('#youtube-preview-list').replaceChildren();$('#youtube-preview-status').textContent='';
  }
  function previewYouTube(draft){
    youtubeDraft=draft;$('#youtube-preview-list').replaceChildren();
    const count=draft.videoIds.length;
    const target=shelf.get('collection/'+$('#youtube-target').value),existing=new Set((target?.entries||[]).map(e=>shelf.get('media/'+e.mediaId)?.videoId).filter(Boolean));
    const fresh=draft.videoIds.filter(id=>!existing.has(id)).length;
    $('#youtube-preview-status').textContent=count+' unique videos found; '+fresh+' new to this collection.'+(draft.playlistId?' Only videos returned by YouTube are included; private, unavailable or omitted items may be missing. Compare with the original playlist.':'');
    for(const id of draft.videoIds.slice(0,100)){const item=document.createElement('p');item.textContent='YouTube video '+id;$('#youtube-preview-list').append(item);}
    if(count>100){const more=document.createElement('p');more.textContent='And '+(count-100)+' more videos.';$('#youtube-preview-list').append(more);}
    $('#youtube-confirm').classList.toggle('hidden',!count);
  }
  $('#add-youtube-btn').onclick=()=>{
    if(!shelf||metadataBlocked){notice('Open a writable library before adding YouTube references.');return;}
    window.coursePlayerPause();resetYouTubePreview();
    $('#youtube-target').replaceChildren(new Option('New collection',''));
    for(const c of courses)if(!shelf.conflicted('collection/'+c.id))$('#youtube-target').append(new Option(c.name,c.id));
    $('#youtube-target').value=!el.watch.classList.contains('hidden')&&currentCourse?currentCourse.id:'';
    $('#youtube-title').value='';$('#youtube-input').value='';openSheet('#youtube-sheet');
  };
  for(const id of ['#youtube-input','#youtube-target','#youtube-title'])$(id).addEventListener('input',resetYouTubePreview);
  for(const b of $$('[data-youtube-policy]'))b.onclick=event=>{event.preventDefault();openYouTubeURL(b.dataset.youtubePolicy,'');};
  $('#youtube-form').onsubmit=async event=>{
    event.preventDefault();resetYouTubePreview();
    try{
      if(!$('#youtube-target').value&&!$('#youtube-title').value.trim())throw Error('Give the new collection a title.');
      const draft=youtube.input($('#youtube-input').value);
      if(draft.videoIds.length){previewYouTube(draft);return;}
      $('#youtube-preview-status').textContent='Loading the playlist from YouTube… The player may need a moment or a tap to make its list available.';
      $('#youtube-provider-preview').classList.remove('hidden');
      const inspection=new window.PaceShelfOnline.Session({mode:'inspect',playlistId:draft.playlistId},$('#youtube-provider-preview'),value=>{
        if(youtubeInspection!==inspection)return;
        if(value.error){$('#youtube-preview-status').textContent=value.error+' You can paste individual video links instead.';return;}
        if(value.playlistIds?.length){
          previewYouTube({...draft,videoIds:value.playlistIds});
          // Capture the ID list before releasing the unprivileged player.
          inspection.close();youtubeInspection=null;$('#youtube-provider-preview').classList.add('hidden');
        }else if(value.closed&&!youtubeDraft)$('#youtube-preview-status').textContent='Playlist preview closed. Try again or paste individual video links.';
      });
      youtubeInspection=inspection;await inspection.open();
    }catch(error){$('#youtube-preview-status').textContent=error.message;}
  };
  $('#youtube-confirm').onclick=async()=>{
    if(!youtubeDraft||!shelf||metadataBlocked)return;
    const button=$('#youtube-confirm');button.disabled=true;
    try{
      const target=$('#youtube-target').value||null;
      const result=shelf.addYouTube({...youtubeDraft,target,title:target?shelf.get('collection/'+target)?.title:$('#youtube-title').value.trim()});
      await persistLibrary();closeSheets();rebuildCourses();libraryFilter='all';$('#course-search').value='';showCourses();
      notice(result.added+' YouTube references added. Open the collection to play, rename or reorder lessons.');
    }catch(error){notice(error.message);}finally{button.disabled=false;}
  };
  $('#device-library-btn').onclick=()=>{
    if(window.Android)Android.openDeviceLibrary();
  };
  window.paceShelfImport=async text=>{
    try{
      if(text.length>16*1024*1024)throw Error("Backup is too large.");
      pendingImport=protocol.validate(JSON.parse(text));
      if(!shelf)throw Error("Choose a library folder first.");
      const adopt=pendingImport.id!==shelf.state.id;
      if(adopt && connection.mode!=="device")throw Error("This backup belongs to a different library. Open its matching portable folder, or choose On this device before restoring a separate library.");
      const merged=adopt?pendingImport:protocol.merge(shelf.state,pendingImport);
      $("#import-preview").textContent=`${adopt?"Replace this device's current library metadata with the selected backup? A recovery copy of the previous metadata will be kept locally.":"Merge metadata from this library backup?"} It contains ${Object.keys(pendingImport.records).length} records. ${Object.values(merged.records).filter(v=>v.length>1).length} conflicting records will need your choice. Original videos are not included or changed. Lessons are available when their relative paths and sizes match the selected folder.`;
      $("#confirm-import").textContent=adopt?"Restore on this device":"Merge backup";
      openSheet("#import-sheet");
    }catch(error){pendingImport=null;notice(error.message);}
  };
  $("#backup-file").onchange=async event=>{const file=event.target.files[0];if(file){if(file.size>16*1024*1024)notice("Backup is too large.");else await window.paceShelfImport(await file.text());}event.target.value="";};
  $("#confirm-import").onclick=async()=>{
    if(!pendingImport || metadataBlocked)return;
    const adopt=pendingImport.id!==shelf.state.id;
    shelf=new protocol.Library(adopt?pendingImport:protocol.merge(shelf.state,pendingImport),shelf.device);pendingImport=null;
    try{await persistLibrary(adopt);closeSheets();rebuildCourses();notice("Backup restored. Review any conflicting changes in Library settings.");}catch(_){}
  };
  window.addEventListener("beforeunload", () => saveProgress(true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.coursePlayerPause(); clearTimeout(saveTimer); clearTimeout(statusTimer);
    } else if (connection?.pending) refreshSaveStatus();
  });
  window.addEventListener("resize",setTopbarH);
  if (window.ResizeObserver) new ResizeObserver(setTopbarH).observe($("#notice"));
  setTopbarH(); applySpeed(false);
  loadLibrary().catch(error => notice(error.message));
})();
