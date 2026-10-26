import { Searchstax } from '@searchstax-inc/searchstudio-ux-js';
import { pageIsOutOfRange, readSearch, responseMatchesSearch, searchUrl } from './search-state.mjs';
import '../../node_modules/@searchstax-inc/searchstudio-ux-js/dist/styles/mainTheme.css';

const status = document.querySelector<HTMLElement>('#search-status')!;
const searchURL = import.meta.env.PUBLIC_SEARCHSTAX_SEARCH_URL;
const searchAuth = import.meta.env.PUBLIC_SEARCHSTAX_READ_ONLY_TOKEN;

if (!searchURL || !searchAuth) {
  status.textContent = 'Search is currently unavailable. Please try again later.';
} else {
  const search = new Searchstax();
  let completed = false;
  let started = false;
  let initializing = true;
  let correctingPage = false;
  let focusResults = false;
  search.initialize({
    language: 'en', searchURL, searchAuth, authType: 'token',
    suggesterURL: '', trackApiKey: '', router: { enabled: false },
    hooks: { beforeSearch: (request) => {
      const query = request.query;
      const url = searchUrl(window.location.href, query, request.page);
      const previous = search.dataLayer.searchObject;
      if (!initializing && !correctingPage && previous.query === query && previous.page !== request.page) {
        focusResults = true;
      }
      if (url.href !== window.location.href) {
        if (initializing || correctingPage) window.history.replaceState(null, '', url);
        else window.history.pushState(null, '', url);
      }
      return request;
    }, afterSearch: (results, response) => {
      completed = true;
      const current = search.dataLayer.searchObject;
      const total = response?.response?.numFound;
      const matches = responseMatchesSearch(current.query, current.page,
        response?.responseHeader.params.q, response?.response?.start, 10);
      if (total !== undefined && matches && pageIsOutOfRange(current.page, total, 10)) {
        queueMicrotask(() => {
          const latest = search.dataLayer.searchObject;
          if (latest.query !== current.query || latest.page !== current.page) return;
          correctingPage = true;
          search.dataLayer.setSearchObject({ ...current, page: 1 });
          correctingPage = false;
        });
      } else if (focusResults) {
        focusResults = false;
        setTimeout(() => document.querySelector<HTMLElement>('#searchstax-results-container a')?.focus(), 0);
      }
      return results.map((result) => ({
        ...result,
        title: result.title?.replace(/\s*\|\s*Alder Coast University Health$/, '') ?? result.title,
      }));
    } },
  });
  search.setCookiesDisabled(true);
  search.addSearchInputWidget('searchstax-input-container', {
    suggestAfterMinChars: 3,
    hooks: { beforeAutosuggest: () => null },
    templates: { mainTemplate: {
      template: `<label class="search-field-label" for="searchstax-search-input">Search the website</label>
        <div class="demo-search-input">
          <input id="searchstax-search-input" type="search" placeholder="Search by keyword" />
          <button id="searchstax-search-input-action-button" type="button">Search</button>
        </div>`,
      searchInputId: 'searchstax-search-input',
    } },
  });
  search.addSearchResultsWidget('searchstax-results-container', {
    renderMethod: 'pagination', resultsPerPage: 10,
    templates: {
      searchResultTemplate: {
        template: '<article class="demo-search-result"><h2><a href="{{url}}" data-searchstax-unique-result-id="{{uniqueId}}">{{title}}</a></h2><p>{{description}}</p></article>',
        searchResultUniqueIdAttribute: 'data-searchstax-unique-result-id',
      },
      noSearchResultTemplate: {
        template: '{{#searchExecuted}}<div class="demo-empty-results"><h2>No results for “{{searchTerm}}”</h2><p>Try a different keyword or a broader term.</p></div>{{/searchExecuted}}',
      },
    },
  });
  search.addPaginationWidget('searchstax-pagination-container', {
    templates: { mainTemplate: {
      template: `{{#results.length}}
        <nav class="demo-pagination" aria-label="Search result pages">
          <span>{{startResultIndex}}–{{endResultIndex}} of {{totalResults}} results</span>
          {{^isFirstPage}}<button type="button" class="demo-previous">Previous</button>{{/isFirstPage}}
          {{^isLastPage}}<button type="button" class="demo-next">Next</button>{{/isLastPage}}
        </nav>{{/results.length}}`,
      previousButtonClass: 'demo-previous', nextButtonClass: 'demo-next',
    } },
  });
  search.dataLayer.setItemsPerPage(10);
  const results = document.querySelector<HTMLElement>('#searchstax-results-container')!;
  const pagination = document.querySelector<HTMLElement>('#searchstax-pagination-container')!;
  // The kit suppresses navigation when its tracking is disabled; preserve normal links.
  results.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) event.stopPropagation();
  }, true);
  search.dataLayer.$loadingChange.subscribe((loading: boolean) => {
    if (loading) {
      started = true;
      completed = false;
      results.hidden = true;
      pagination.hidden = true;
      status.textContent = 'Searching…';
    } else if (started) {
      // The kit signals loading complete before calling afterSearch.
      setTimeout(() => {
        if (!search.dataLayer.loading) {
          results.hidden = !completed;
          pagination.hidden = !completed;
          if (!completed) focusResults = false;
          status.textContent = completed ? '' : 'Search is currently unavailable. Please try again.';
        }
      }, 0);
    }
  });
  const { query, page } = readSearch(window.location.href);
  if (query) search.dataLayer.setSearchObject({
    ...search.dataLayer.searchObject, query, page,
  });
  initializing = false;
  window.addEventListener('popstate', () => window.location.reload());
}
