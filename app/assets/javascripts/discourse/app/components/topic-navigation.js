import Component from "@ember/component";
import { inject as service } from "@ember/service";
import SwipeEvents from "discourse/lib/swipe-events";
import EmberObject from "@ember/object";
import discourseDebounce from "discourse-common/lib/debounce";
import { headerOffset } from "discourse/lib/offset-calculator";
import { next } from "@ember/runloop";
import discourseLater from "discourse-common/lib/later";
import { bind, observes } from "discourse-common/utils/decorators";
import JumpToPost from "./modal/jump-to-post";

const MIN_WIDTH_TIMELINE = 925;
const MIN_HEIGHT_TIMELINE = 325;

export default Component.extend({
  modal: service(),

  classNameBindings: [
    "info.topicProgressExpanded:topic-progress-expanded",
    "info.renderTimeline:with-timeline:with-topic-progress",
  ],
  composerOpen: null,
  info: null,
  isSwiping: false,
  canRender: true,
  _lastTopicId: null,
  _swipeEvents: null,

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

  onSwipeStart(event) {
    const e = event.detail;
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
      this.isSwiping = false;
    } else if (e.direction === "up" || e.direction === "down") {
      this.isSwiping = true;
      this.movingElement = document.querySelector(".timeline-container");
    }
  },

  onSwipeEnd(event) {
    if (!this.isSwiping) {
      return;
    }
    const e = event.detail;
    this.isSwiping = false;
    const timelineContainer = document.querySelector(".timeline-container");
    const maxOffset = timelineContainer.offsetHeight;

    let durationMs = this._swipeEvents.getMaxAnimationTimeMs();
    if (this._swipeEvents.shouldCloseMenu(e, "bottom")) {
      const distancePx = maxOffset - this.pxClosed;
      durationMs = this._swipeEvents.getMaxAnimationTimeMs(
        distancePx / Math.abs(e.velocityY)
      );
      timelineContainer
        .animate([{ transform: `translate3d(0, ${maxOffset}px, 0)` }], {
          duration: durationMs,
          fill: "forwards",
        })
        .finished.then(() => this._collapseFullscreen(0));
    } else {
      const distancePx = this.pxClosed;
      durationMs = this._swipeEvents.getMaxAnimationTimeMs(
        distancePx / Math.abs(e.velocityY)
      );
      timelineContainer.animate([{ transform: `translate3d(0, 0, 0)` }], {
        duration: durationMs,
        fill: "forwards",
        easing: "ease-out",
      });
    }
  },

  onSwipe(event) {
    if (!this.isSwiping) {
      return;
    }
    const e = event.detail;
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
    this._swipeEvents = new SwipeEvents(this.element);
    if (this.site.mobileView) {
      this._swipeEvents.addTouchListeners();
      this._swipeStart = (e) => this.onSwipeStart(e);
      this._swipeEnd = (e) => this.onSwipeEnd(e);
      this._swipe = (e) => this.onSwipe(e);
      this.element.addEventListener("swipestart", this._swipeStart);
      this.element.addEventListener("swipeend", this._swipeEnd);
      this.element.addEventListener("swipe", this._swipe);
    }
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
    if (this.site.mobileView) {
      this.element.removeEventListener("swipestart", this._swipeStart);
      this.element.removeEventListener("swipeend", this._swipeEnd);
      this.element.removeEventListener("swipe", this._swipe);
      this._swipeEvents.removeTouchListeners();
    }
  },
});
