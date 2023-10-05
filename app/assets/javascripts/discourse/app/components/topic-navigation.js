import Component from "@ember/component";
import { inject as service } from "@ember/service";
import PanEvents, {
  SWIPE_DISTANCE_THRESHOLD,
  SWIPE_VELOCITY_THRESHOLD,
} from "discourse/mixins/pan-events";
import EmberObject from "@ember/object";
import discourseDebounce from "discourse-common/lib/debounce";
import { headerOffset } from "discourse/lib/offset-calculator";
import { next } from "@ember/runloop";
import discourseLater from "discourse-common/lib/later";
import { bind, observes } from "discourse-common/utils/decorators";
import JumpToPost from "./modal/jump-to-post";

const MIN_WIDTH_TIMELINE = 925;
const MIN_HEIGHT_TIMELINE = 325;

export default Component.extend(PanEvents, {
  modal: service(),

  classNameBindings: [
    "info.topicProgressExpanded:topic-progress-expanded",
    "info.renderTimeline:with-timeline:with-topic-progress",
  ],
  composerOpen: null,
  info: null,
  isPanning: false,
  canRender: true,
  _lastTopicId: null,
  _MAX_ANIMATION_TIME: 200,

  init() {
    this._super(...arguments);
    this.set("info", EmberObject.create());
  },

  didUpdateAttrs() {
    this._super(...arguments);
    if (this._lastTopicId !== this.topic.id) {
      this._lastTopicId = this.topic.id;
      this.set("canRender", false);
      next(() => this.set("canRender", true));
    }
  },

  _performCheckSize() {
    if (!this.element || this.isDestroying || this.isDestroyed) {
      return;
    }

    if (this.info.topicProgressExpanded) {
      this.info.set("renderTimeline", true);
    } else if (this.site.mobileView) {
      this.info.set("renderTimeline", false);
    } else {
      const composerHeight =
        document.querySelector("#reply-control")?.offsetHeight || 0;
      const verticalSpace =
        window.innerHeight - composerHeight - headerOffset();

      this.info.set(
        "renderTimeline",
        this.mediaQuery.matches && verticalSpace > MIN_HEIGHT_TIMELINE
      );
    }
  },

  @bind
  _checkSize() {
    discourseDebounce(this, this._performCheckSize, 200, true);
  },

  // we need to store this so topic progress has something to init with
  _topicScrolled(event) {
    this.set("info.prevEvent", event);
  },

  @observes("info.topicProgressExpanded")
  _expanded() {
    if (this.get("info.topicProgressExpanded")) {
      $(window).on("click.hide-fullscreen", (e) => {
        let $target = $(e.target);
        let $parents = $target.parents();
        if (
          !$target.is(".widget-button") &&
          !$parents.is(".widget-button") &&
          !$parents.is("#discourse-modal") &&
          !$target.is("#discourse-modal") &&
          !$parents.is(".modal-footer") &&
          ($target.is(".topic-timeline") ||
            !$parents.is("#topic-progress-wrapper")) &&
          !$parents.is(".timeline-open-jump-to-post-prompt-btn") &&
          !$target.is(".timeline-open-jump-to-post-prompt-btn")
        ) {
          this._collapseFullscreen();
        }
      });
    } else {
      $(window).off("click.hide-fullscreen");
    }
    this._checkSize();
  },

  composerOpened() {
    this.set("composerOpen", true);
    this._checkSize();
  },

  composerClosed() {
    this.set("composerOpen", false);
    this._checkSize();
  },

  _collapseFullscreen(delay = 500) {
    if (this.get("info.topicProgressExpanded")) {
      $(".timeline-fullscreen").removeClass("show");
      discourseLater(() => {
        if (!this.element || this.isDestroying || this.isDestroyed) {
          return;
        }

        this.set("info.topicProgressExpanded", false);
        this._checkSize();
      }, delay);
    }
  },

  keyboardTrigger(e) {
    if (e.type === "jump") {
      this.modal.show(JumpToPost, {
        model: {
          topic: this.topic,
          jumpToIndex: this.attrs.jumpToIndex,
          jumpToDate: this.attrs.jumpToDate,
        },
      });
    }
  },

  _getMaxAnimationTime(durationMs = this._MAX_ANIMATION_TIME) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return 0;
    }
    return Math.min(durationMs, this._MAX_ANIMATION_TIME);
  },

  _handlePanDone(event) {
    const timelineContainer = document.querySelector(".timeline-container");
    const maxOffset = timelineContainer.offsetHeight;

    let durationMs = this._getMaxAnimationTime();
    if (this._shouldPanClose(event)) {
      const distancePx = maxOffset - this.pxClosed;
      durationMs = this._getMaxAnimationTime(
        distancePx / Math.abs(event.velocityY)
      );
      timelineContainer.animate(
        [{ transform: `translate3d(0, ${maxOffset}px, 0)` }],
        { duration: durationMs, fill: "forwards" }
      );

      this._collapseFullscreen(durationMs);
    } else {
      const distancePx = this.pxClosed;
      durationMs = this._getMaxAnimationTime(
        distancePx / Math.abs(event.velocityY)
      );
      timelineContainer.animate(
        [{ transform: `translate3d(0, 0, 0)`, easing: "ease-out" }],
        { duration: durationMs, fill: "forwards" }
      );
    }
  },

  _shouldPanClose(e) {
    return (
      (e.deltaY > SWIPE_DISTANCE_THRESHOLD &&
        e.velocityY > -SWIPE_VELOCITY_THRESHOLD) ||
      e.velocityY > SWIPE_VELOCITY_THRESHOLD
    );
  },

  panStart(e) {
    const target = e.originalEvent.target;

    if (
      target.classList.contains("docked") ||
      !target.closest(".timeline-container")
    ) {
      return;
    }

    e.originalEvent.preventDefault();
    const centeredElement = document.elementFromPoint(e.center.x, e.center.y);
    if (centeredElement.closest(".timeline-scrollarea-wrapper")) {
      this.isPanning = false;
    } else if (e.direction === "up" || e.direction === "down") {
      this.isPanning = true;
      this.movingElement = document.querySelector(".timeline-container");
    }
  },

  panEnd(e) {
    if (!this.isPanning) {
      return;
    }
    e.originalEvent.preventDefault();
    this.isPanning = false;
    this._handlePanDone(e);
  },

  panMove(e) {
    if (!this.isPanning) {
      return;
    }
    e.originalEvent.preventDefault();
    this.pxClosed = Math.max(0, e.deltaY);

    this.movingElement.animate(
      [{ transform: `translate3d(0, ${this.pxClosed}px, 0)` }],
      { fill: "forwards" }
    );
  },

  didInsertElement() {
    this._super(...arguments);

    this._lastTopicId = this.topic.id;

    this.appEvents
      .on("topic:current-post-scrolled", this, this._topicScrolled)
      .on("topic:jump-to-post", this, this._collapseFullscreen)
      .on("topic:keyboard-trigger", this, this.keyboardTrigger);

    if (this.site.desktopView) {
      this.mediaQuery = matchMedia(`(min-width: ${MIN_WIDTH_TIMELINE}px)`);
      this.mediaQuery.addEventListener("change", this._checkSize);
      this.appEvents.on("composer:opened", this, this.composerOpened);
      this.appEvents.on("composer:resize-ended", this, this.composerOpened);
      this.appEvents.on("composer:closed", this, this.composerClosed);
      $("#reply-control").on("div-resized", this._checkSize);
    }

    this._checkSize();
  },

  willDestroyElement() {
    this._super(...arguments);

    this.appEvents
      .off("topic:current-post-scrolled", this, this._topicScrolled)
      .off("topic:jump-to-post", this, this._collapseFullscreen)
      .off("topic:keyboard-trigger", this, this.keyboardTrigger);

    $(window).off("click.hide-fullscreen");

    if (this.site.desktopView) {
      this.mediaQuery.removeEventListener("change", this._checkSize);
      this.appEvents.off("composer:opened", this, this.composerOpened);
      this.appEvents.off("composer:resize-ended", this, this.composerOpened);
      this.appEvents.off("composer:closed", this, this.composerClosed);
      $("#reply-control").off("div-resized", this._checkSize);
    }
  },
});
