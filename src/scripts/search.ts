import { Searchstax } from '@searchstax-inc/searchstudio-ux-js';
import '../../node_modules/@searchstax-inc/searchstudio-ux-js/dist/styles/mainTheme.css';

const status = document.querySelector<HTMLElement>('#search-status')!;
const searchURL = import.meta.env.PUBLIC_SEARCHSTAX_SEARCH_URL;
const searchAuth = import.meta.env.PUBLIC_SEARCHSTAX_READ_ONLY_TOKEN;

if (!searchURL || !searchAuth) {
  status.textContent = 'Search is currently unavailable. Please try again later.';
} else {
  const search = new Searchstax();
  let completed = false;
  search.initialize({
    language: 'en', searchURL, searchAuth, authType: 'token',
    suggesterURL: '', trackApiKey: '', router: { enabled: false },
    hooks: { beforeSearch: (request) => {
      const url = new URL(window.location.href);
      const query = request.query;
      if (query && query !== '*') url.searchParams.set('q', query);
      else url.searchParams.delete('q');
      if (request.page > 1) url.searchParams.set('page', String(request.page));
      else url.searchParams.delete('page');
      window.history.replaceState(null, '', url);
      return request;
    }, afterSearch: (results) => {
      completed = true;
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
      completed = false;
      results.hidden = true;
      pagination.hidden = true;
      status.textContent = 'Searching…';
    } else {
      // The kit signals loading complete before calling afterSearch.
      setTimeout(() => {
        if (!search.dataLayer.loading) {
          results.hidden = !completed;
          pagination.hidden = !completed;
          status.textContent = completed ? '' : 'Search is currently unavailable. Please try again.';
        }
      }, 0);
    }
  });
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q')?.trim();
  const page = Number(params.get('page'));
  if (query) search.dataLayer.setSearchObject({
    ...search.dataLayer.searchObject, query,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  });
}
