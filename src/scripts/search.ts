import { Searchstax, type ISearchObject } from '@searchstax-inc/searchstudio-ux-js';
import { CONTENT_TYPE_FIELD, CONTENT_TYPE_LABELS, normalizeTypes, pageIsOutOfRange, readSearch, responseMatchesSearch, searchUrl } from './search-state.mjs';
import { resultPresentation, typesFromResponse } from './search-presentation.mjs';
import '../../node_modules/@searchstax-inc/searchstudio-ux-js/dist/styles/mainTheme.css';

const status = document.querySelector<HTMLElement>('#search-status')!;
const workspace = document.querySelector<HTMLElement>('#search-workspace')!;
const results = document.querySelector<HTMLElement>('#searchstax-results-container')!;
const pagination = document.querySelector<HTMLElement>('#searchstax-pagination-container')!;
const summary = document.querySelector<HTMLElement>('#search-results-summary')!;
const selectedTypes = document.querySelector<HTMLElement>('#selected-types')!;
const facets = document.querySelector<HTMLElement>('#searchstax-facets-container')!;
const refinements = document.querySelector<HTMLDetailsElement>('#search-refinements')!;
const searchURL = import.meta.env.PUBLIC_SEARCHSTAX_SEARCH_URL;
const searchAuth = import.meta.env.PUBLIC_SEARCHSTAX_READ_ONLY_TOKEN;
const typesOf = (request: ISearchObject) => normalizeTypes(request.facets
  .filter(facet => facet.name === CONTENT_TYPE_FIELD).map(facet => facet.value));
const typeLabel = (type: string) => Object.hasOwn(CONTENT_TYPE_LABELS, type) ? CONTENT_TYPE_LABELS[type as keyof typeof CONTENT_TYPE_LABELS] : type;
const desktop = window.matchMedia('(min-width: 760px)');
const setDisclosure = () => { refinements.open = desktop.matches; };
setDisclosure();
desktop.addEventListener('change', setDisclosure);

if (!searchURL || !searchAuth) {
  status.textContent = 'Search is currently unavailable. Please try again later.';
} else {
  const search = new Searchstax();
  let completed = false;
  let started = false;
  let initializing = true;
  let correctingPage = false;
  let pendingPageCorrection: ISearchObject | null = null;
  let focusResults = false;
  let restoreFocus: string | null = null;
  let initialResponseReady = false;
  let restoreInitialInputFocus = false;
  function syncInitialSearchControls() {
    // The kit's initial metadata request cannot be aborted. Keep that first
    // request atomic so a second query cannot receive its stale facets/counts.
    const disabled = !initialResponseReady && search.dataLayer.loading;
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#searchstax-input-container input, #searchstax-input-container button')) {
      if (disabled && control instanceof HTMLInputElement && document.activeElement === control) restoreInitialInputFocus = true;
      control.disabled = disabled;
    }
    if (!disabled && restoreInitialInputFocus) {
      if (document.activeElement === document.body) document.querySelector<HTMLInputElement>('#searchstax-search-input')?.focus();
      restoreInitialInputFocus = false;
    }
  }

  function selectTypes(types: string[]) {
    search.dataLayer.setSearchObject({ ...search.dataLayer.searchObject, page: 1,
      facets: normalizeTypes(types).map(value => ({ name: CONTENT_TYPE_FIELD, value, type: 'or' as const })) });
  }

  function renderSelections() {
    const types = typesOf(search.dataLayer.searchObject);
    selectedTypes.replaceChildren();
    selectedTypes.hidden = types.length === 0;
    document.querySelector('#filter-selection-count')!.textContent = types.length ? `(${types.length})` : '';
    document.querySelector('#search-results-context')!.textContent = types.length ? 'Filtered by content type' : 'Across all content';
    for (const type of types) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'selected-type';
      button.textContent = `${typeLabel(type)} ×`;
      button.setAttribute('aria-label', `Remove ${typeLabel(type)} filter`);
      button.addEventListener('click', () => {
        restoreFocus = 'summary';
        selectTypes(types.filter(value => value !== type));
      });
      selectedTypes.append(button);
    }
    if (types.length) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'clear-types';
      clear.textContent = 'Clear filters';
      clear.addEventListener('click', () => { restoreFocus = 'summary'; selectTypes([]); });
      selectedTypes.append(clear);
    }
  }

  // The kit owns checkbox selection and query generation. Translate only visible
  // labels, including cached OR facets, without changing the raw filter values.
  function labelFacets() {
    const selected = new Set(typesOf(search.dataLayer.searchObject));
    for (const checkbox of facets.querySelectorAll<HTMLInputElement>('input[data-content-type-value]')) {
      checkbox.checked = selected.has(checkbox.dataset.contentTypeValue!);
    }
    for (const label of facets.querySelectorAll<HTMLElement>('[data-content-type]')) {
      const friendly = typeLabel(label.dataset.contentType!);
      if (label.textContent !== friendly) label.textContent = friendly;
    }
    document.querySelector<HTMLElement>('#filter-empty')!.hidden = Boolean(facets.querySelector('input'));
  }
  new MutationObserver(labelFacets).observe(facets, { childList: true, subtree: true });
  facets.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof HTMLInputElement) restoreFocus = target.dataset.contentTypeValue ?? null;
  });

  search.initialize({
    language: 'en', searchURL, searchAuth, authType: 'token',
    suggesterURL: '', trackApiKey: '', router: { enabled: false },
    hooks: {
      beforeSearch: request => {
        const previous = search.dataLayer.searchObject;
        if (!initializing && previous.query !== request.query) {
          request = { ...request, facets: [], page: 1 };
        }
        const types = typesOf(request);
        if (previous.query !== request.query || previous.page !== request.page || typesOf(previous).join(',') !== types.join(',')) completed = false;
        // Restrict this UI to the one approved facet and default relevance order.
        request = { ...request, order: '', facets: types.map(value => ({ name: CONTENT_TYPE_FIELD, value, type: 'or' })) };
        if (!initializing && !correctingPage && previous.query === request.query && previous.page !== request.page) focusResults = true;
        const url = searchUrl(window.location.href, request.query, request.page, types);
        if (url.href !== window.location.href) {
          if (initializing || correctingPage) window.history.replaceState(null, '', url);
          else window.history.pushState(null, '', url);
        }
        return request;
      },
      afterSearch: (items, response) => {
        const current = search.dataLayer.searchObject;
        const total = response?.response?.numFound;
        const matches = responseMatchesSearch(current.query, current.page,
          response?.responseHeader.params.q, response?.response?.start, 10, typesOf(current), typesFromResponse(response));
        if (!matches) return search.dataLayer.searchResults ?? [];
        completed = true;
        if (total !== undefined && pageIsOutOfRange(current.page, total, 10)) {
          pendingPageCorrection = current;
        }
        summary.textContent = `${total ?? 0} ${(total ?? 0) === 1 ? 'result' : 'results'} for “${current.query}”`;
        renderSelections();
        return items.map(result => ({ ...result,
          title: result.title?.replace(/\s*\|\s*Alder Coast University Health$/, '') ?? result.title,
          custom: resultPresentation(result, import.meta.env.BASE_URL),
        }));
      },
    },
  });
  search.setCookiesDisabled(true);
  search.addSearchInputWidget('searchstax-input-container', {
    suggestAfterMinChars: 3, hooks: { beforeAutosuggest: () => null },
    templates: { mainTemplate: {
      template: `<label class="search-field-label" for="searchstax-search-input">Search the website</label>
        <div class="demo-search-input"><input id="searchstax-search-input" type="search" placeholder="What are you looking for?" />
          <button id="searchstax-search-input-action-button" type="button">Search</button></div>`,
      searchInputId: 'searchstax-search-input',
    } },
  });
  new MutationObserver(syncInitialSearchControls).observe(document.querySelector('#searchstax-input-container')!, { childList: true, subtree: true });
  search.addSearchResultsWidget('searchstax-results-container', {
    renderMethod: 'pagination', resultsPerPage: 10,
    templates: {
      searchResultTemplate: {
        template: `<article class="demo-search-result">
          <div class="result-meta">{{#custom.typeLabel}}<span class="result-type">{{custom.typeLabel}}</span>{{/custom.typeLabel}}
            {{#custom.breadcrumb}}<span class="result-breadcrumb">{{custom.breadcrumb}}</span>{{/custom.breadcrumb}}</div>
          <h2><a href="{{url}}" data-searchstax-unique-result-id="{{uniqueId}}">{{title}}</a><span aria-hidden="true" class="result-arrow"> ↗</span></h2>
          <p>{{description}}</p></article>`,
        searchResultUniqueIdAttribute: 'data-searchstax-unique-result-id',
      },
      noSearchResultTemplate: {
        template: '{{#searchExecuted}}<div class="demo-empty-results"><h3>No matching pages</h3><p>Try a broader keyword or clear your filters.</p></div>{{/searchExecuted}}',
      },
    },
  });
  search.addFacetsWidget('searchstax-facets-container', {
    facetingType: 'or', specificFacets: [CONTENT_TYPE_FIELD], itemsPerPageDesktop: 20, itemsPerPageMobile: 20,
    templates: {
      mainTemplateDesktop: { template: '<div class="demo-facet-groups"></div>', facetsContainerClass: 'demo-facet-groups' },
      // A single native disclosure contains the same controls at every width.
      mainTemplateMobile: { template: ' ' },
      facetItemContainerTemplate: {
        template: '<fieldset class="demo-facet-group"><legend>Content type</legend><div class="demo-facet-options"></div></fieldset>',
        facetListContainerClass: 'demo-facet-options',
      },
      facetItemTemplate: {
        template: `<label class="demo-facet-option"><input type="checkbox" class="demo-facet-checkbox" data-content-type-value="{{value}}" {{#disabled}}disabled{{/disabled}} {{#isChecked}}checked{{/isChecked}} />
          <span data-content-type="{{value}}">{{value}}</span><span class="facet-count"><span class="visually-hidden">Result count: </span>{{count}}</span></label>`,
        inputCheckboxClass: 'demo-facet-checkbox', checkTriggerClasses: [],
      },
    },
  });
  search.addPaginationWidget('searchstax-pagination-container', {
    templates: { mainTemplate: {
      template: `{{#results.length}}<nav class="demo-pagination" aria-label="Search result pages">
          <span>{{startResultIndex}}–{{endResultIndex}} of {{totalResults}} results</span>
          {{^isFirstPage}}<button type="button" class="demo-previous">Previous</button>{{/isFirstPage}}
          {{^isLastPage}}<button type="button" class="demo-next">Next</button>{{/isLastPage}}
        </nav>{{/results.length}}`,
      previousButtonClass: 'demo-previous', nextButtonClass: 'demo-next',
    } },
  });
  search.dataLayer.setItemsPerPage(10);
  results.addEventListener('click', event => {
    if ((event.target as Element).closest('a')) event.stopPropagation();
  }, true);
  search.dataLayer.$loadingChange.subscribe((loading: boolean) => {
    if (loading) {
      started = true;
      syncInitialSearchControls();
      // The kit also loads OR facet counts after a successful filtered reload.
      // That auxiliary request must not invalidate the completed result set.
      results.hidden = true;
      pagination.hidden = true;
      workspace.setAttribute('aria-busy', 'true');
      status.textContent = 'Searching…';
    } else if (started) {
      setTimeout(() => {
        if (search.dataLayer.loading) return;
        // Finish the initial OR facet-cache request before correcting a stale
        // page link, so its loading state cannot unlock a newer query early.
        if (pendingPageCorrection) {
          const pending = pendingPageCorrection;
          pendingPageCorrection = null;
          const current = search.dataLayer.searchObject;
          if (current.query === pending.query && current.page === pending.page && typesOf(current).join(',') === typesOf(pending).join(',')) {
            correctingPage = true;
            search.dataLayer.setSearchObject({ ...current, page: 1 });
            correctingPage = false;
            return;
          }
        }
        if (completed) initialResponseReady = true;
        syncInitialSearchControls();
        const hasQuery = Boolean(readSearch(window.location.href).query);
        workspace.hidden = !completed || !hasQuery;
        workspace.setAttribute('aria-busy', 'false');
        results.hidden = !completed;
        pagination.hidden = !completed;
        status.textContent = !hasQuery ? 'Enter a search term to get started.' : completed ? '' : 'Search is currently unavailable. Please try again.';
        labelFacets();
        if (completed && restoreFocus) {
          if (restoreFocus === 'summary') summary.focus();
          else facets.querySelector<HTMLInputElement>(`input[data-content-type-value="${restoreFocus}"]`)?.focus();
        } else if (completed && focusResults) {
          (results.querySelector<HTMLElement>('h2 a') ?? summary).focus();
        }
        restoreFocus = null;
        focusResults = false;
      }, 0);
    }
  });
  const { query, page, types } = readSearch(window.location.href);
  if (query) search.dataLayer.setSearchObject({ ...search.dataLayer.searchObject, query, page,
    facets: types.map(value => ({ name: CONTENT_TYPE_FIELD, value, type: 'or' })) });
  initializing = false;
  window.addEventListener('popstate', () => window.location.reload());
}
