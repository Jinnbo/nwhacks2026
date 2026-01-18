// Wait for Supabase to be available (loaded via script tag in HTML)
// Config is loaded via script tag in HTML, so SUPABASE_URL and SUPABASE_ANON_KEY are globals
// The UMD build exposes 'supabase' as a global with createClient
let supabase;
function initSupabase() {
  if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
  }
  return false;
}

// Wait for Supabase to load
if (!initSupabase()) {
  // Poll for supabase to be available
  const checkSupabase = setInterval(() => {
    if (initSupabase()) {
      clearInterval(checkSupabase);
      initializeApp();
    }
  }, 10);
  
  // Fallback timeout
  setTimeout(() => {
    clearInterval(checkSupabase);
    if (!supabase) {
      console.error('Failed to load Supabase library');
      alert('Failed to load Supabase library. Please refresh the extension.');
    }
  }, 5000);
} else {
  initializeApp();
}

// Initialize the app after Supabase is ready
function initializeApp() {
  // Get DOM elements
  const loginContainer = document.getElementById('loginContainer');
  const loggedInContainer = document.getElementById('loggedInContainer');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userInfo = document.getElementById('userInfo');
  const usersList = document.getElementById('usersList');
  const usersListLoading = document.getElementById('usersListLoading');
  const stickerBanner = document.getElementById('stickerBanner');
  
  // Show login UI
  function showLoginState() {
    loginContainer.style.display = 'flex';
    loggedInContainer.style.display = 'none';
  }

  // Show logged in UI
  function showLoggedInState(user) {
    loginContainer.style.display = 'none';
    loggedInContainer.style.display = 'flex';
    
    if (user.email) {
      userInfo.textContent = `Logged in as: ${user.email}`;
    } else {
      userInfo.textContent = 'Logged in';
    }
    
    // Fetch and display users list
    fetchAllUsers(user.id);
    
    // Set up Realtime subscription for stickers
    setupRealtimeSubscription(user.id);
  }

  // Check authentication state on load
  async function checkAuthState() {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('Error getting session:', error);
        showLoginState();
        return;
      }

      if (session) {
        showLoggedInState(session.user);
      } else {
        showLoginState();
      }
    } catch (error) {
      console.error('Error checking auth state:', error);
      showLoginState();
    }
  }

  // Login with Google using Chrome identity API
  async function loginWithGoogle() {
    try {
      // Get the redirect URL for Chrome extension
      const redirectUrl = chrome.identity.getRedirectURL();
      console.log('Redirect URL:', redirectUrl);
      console.log('Make sure this URL is added to Supabase redirect URLs:', redirectUrl);
      
      // Get the OAuth URL from Supabase with skipBrowserRedirect
      // This tells Supabase not to redirect in the browser, we'll handle it with Chrome identity API
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true
        }
      });

      if (error) {
        console.error('Error initiating OAuth:', error);
        alert('Failed to start login: ' + error.message);
        return;
      }

      if (!data.url) {
        console.error('No OAuth URL returned');
        alert('Failed to get OAuth URL from Supabase');
        return;
      }

      console.log('Launching OAuth flow with URL:', data.url);

      // Use Chrome identity API to launch OAuth flow
      chrome.identity.launchWebAuthFlow(
        {
          url: data.url,
          interactive: true
        },
        async (callbackUrl) => {
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError;
            const errorMessage = error.message || error.toString() || 'Unknown error';
            console.error('OAuth flow error:', error);
            console.error('Error message:', errorMessage);
            console.error('Full error object:', JSON.stringify(error, null, 2));
            
            // Don't show alert if user cancelled
            const isCancelled = errorMessage.toLowerCase().includes('canceled') || 
                              errorMessage.toLowerCase().includes('user_cancel') ||
                              errorMessage.toLowerCase().includes('access_denied');
            
            if (!isCancelled) {
              alert('Login failed: ' + errorMessage + '\n\nMake sure you have configured the redirect URL in Supabase:\n' + redirectUrl);
            }
            return;
          }

          if (!callbackUrl) {
            console.error('No callback URL received');
            return;
          }

          console.log('Callback URL received:', callbackUrl);

          // Parse the callback URL to extract tokens
          try {
            const url = new URL(callbackUrl);
            
            // Check for tokens in hash (implicit flow)
            if (url.hash) {
              const hash = url.hash.substring(1);
              const params = new URLSearchParams(hash);
              const access_token = params.get('access_token');
              const refresh_token = params.get('refresh_token');
              
              if (access_token && refresh_token) {
                // Set the session
                const { data: { session }, error: sessionError } = await supabase.auth.setSession({
                  access_token,
                  refresh_token
                });

                if (sessionError) {
                  console.error('Error setting session:', sessionError);
                  alert('Failed to complete login: ' + sessionError.message);
                  return;
                }

                if (session) {
                  console.log('Login successful!', session.user);
                  showLoggedInState(session.user);
                }
                return;
              }
            }
            
            // Check for code in query params (PKCE flow)
            const code = url.searchParams.get('code');
            if (code) {
              // Use getSessionFromUrl to handle PKCE flow
              const { data: { session }, error: sessionError } = await supabase.auth.getSessionFromUrl(callbackUrl);
              
              if (sessionError) {
                console.error('Error getting session from URL:', sessionError);
                alert('Failed to complete login: ' + sessionError.message);
                return;
              }
              
              if (session) {
                console.log('Login successful!', session.user);
                showLoggedInState(session.user);
              }
              return;
            }
            
            // Try getSessionFromUrl as fallback
            const { data: { session }, error: sessionError } = await supabase.auth.getSessionFromUrl(callbackUrl);
            
            if (sessionError) {
              console.error('Error getting session from URL:', sessionError);
              // Check if we already have a session (might have been set automatically)
              const { data: { session: existingSession } } = await supabase.auth.getSession();
              if (existingSession) {
                console.log('Found existing session after OAuth');
                showLoggedInState(existingSession.user);
              } else {
                alert('Failed to complete login. Please try again.');
              }
              return;
            }
            
            if (session) {
              console.log('Login successful!', session.user);
              showLoggedInState(session.user);
            }
          } catch (parseError) {
            console.error('Error parsing callback URL:', parseError);
            alert('Failed to parse OAuth callback. Please try again.');
          }
        }
      );
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed: ' + error.message);
    }
  }

  // Logout function
  async function logout() {
    try {
      // Clean up Realtime subscription
      cleanupRealtimeSubscription();
      
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Logout error:', error);
        alert('Failed to logout: ' + error.message);
      } else {
        showLoginState();
        // Clear users list
        usersList.innerHTML = '';
        // Hide banner
        hideStickerBanner();
      }
    } catch (error) {
      console.error('Logout error:', error);
      showLoginState();
      usersList.innerHTML = '';
      hideStickerBanner();
    }
  }

  // Fetch all users from Supabase
  async function fetchAllUsers(currentUserId) {
    try {
      // Show loading state
      usersListLoading.classList.add('show');
      usersList.classList.add('empty');
      
      // Query the user_list view
      const { data, error } = await supabase
        .from('user_list')
        .select('id, display_name, email')
        .order('display_name', { ascending: true, nullsFirst: false });
      
      if (error) {
        console.error('Error fetching users:', error);
        usersList.innerHTML = '<div class="loading">Error loading users</div>';
        usersListLoading.classList.remove('show');
        return;
      }
      
      // Show all users including current user (for testing)
      renderUsersList(data);
      
      usersListLoading.classList.remove('show');
    } catch (error) {
      console.error('Error fetching users:', error);
      usersList.innerHTML = '<div class="loading">Error loading users</div>';
      usersListLoading.classList.remove('show');
    }
  }

  // Render users list
  function renderUsersList(users) {
    if (!users || users.length === 0) {
      usersList.innerHTML = '<div class="loading">No other users found</div>';
      usersList.classList.remove('empty');
      return;
    }
    
    usersList.innerHTML = '';
    usersList.classList.remove('empty');
    
    users.forEach(user => {
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      
      // Use display_name if available, otherwise fallback to email
      const displayName = user.display_name || user.email || 'Unknown User';
      userItem.textContent = displayName;
      
      // Add click handler
      userItem.addEventListener('click', () => {
        handleUserClick(user.id, displayName);
      });
      
      usersList.appendChild(userItem);
    });
  }

  // Set up Realtime subscription via background service worker
  function setupRealtimeSubscription(userId) {
    console.log('Notifying background to start Realtime subscription for user:', userId);
    
    // Send message to background service worker to start Realtime subscription
    chrome.runtime.sendMessage(
      {
        type: 'START_REALTIME',
        userId: userId
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending START_REALTIME to background:', chrome.runtime.lastError);
        } else {
          console.log('Background START_REALTIME response:', response);
        }
      }
    );
  }

  // Clean up Realtime subscription via background service worker
  function cleanupRealtimeSubscription() {
    console.log('Notifying background to stop Realtime subscription');
    
    // Send message to background service worker to stop Realtime subscription
    chrome.runtime.sendMessage(
      {
        type: 'STOP_REALTIME'
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending STOP_REALTIME to background:', chrome.runtime.lastError);
        } else {
          console.log('Background STOP_REALTIME response:', response);
        }
      }
    );
  }

  // Show sticker banner
  function showStickerBanner(sticker) {
    if (!stickerBanner) return;
    
    // Get sender info if available (we'll fetch it)
    const bannerContent = document.createElement('div');
    bannerContent.className = 'sticker-banner-content';
    
    const message = document.createElement('div');
    message.className = 'sticker-banner-message';
    message.textContent = '🎉 You received a new sticker!';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sticker-banner-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => {
      hideStickerBanner();
    });
    
    bannerContent.appendChild(message);
    bannerContent.appendChild(closeBtn);
    
    stickerBanner.innerHTML = '';
    stickerBanner.appendChild(bannerContent);
    stickerBanner.classList.add('show');
    
    // Auto-hide after 8 seconds
    setTimeout(() => {
      hideStickerBanner();
    }, 8000);
  }

  // Hide sticker banner
  function hideStickerBanner() {
    if (stickerBanner) {
      stickerBanner.classList.remove('show');
      // Clear content after animation
      setTimeout(() => {
        stickerBanner.innerHTML = '';
      }, 300);
    }
  }

  // Handle user click - create sticker record
  async function handleUserClick(recipientId, displayName) {
    try {
      // Get current user session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        console.error('Error getting session:', sessionError);
        alert('Error: Not logged in. Please log in again.');
        return;
      }
      
      const senderId = session.user.id;
      
      // Hardcoded image URL
      const imageUrl = 'https://xrvicqszlafncvfmqydp.supabase.co/storage/v1/object/public/sticker/fnaf-gif.gif';
      
      // Insert sticker record
      const { data, error } = await supabase
        .from('stickers')
        .insert([
          {
            sender_id: senderId,
            recipient_id: recipientId,
            image_url: imageUrl
          }
        ])
        .select();
      
      if (error) {
        console.error('Error creating sticker:', error);
        alert(`Failed to send sticker to ${displayName}:\n${error.message}`);
        return;
      }
      
      // Success!
      console.log('Sticker sent successfully:', data);
      alert(`✓ Sticker sent to ${displayName}!`);
      
    } catch (error) {
      console.error('Error in handleUserClick:', error);
      alert(`Error sending sticker:\n${error.message}`);
    }
  }

  // Event listeners
  loginBtn.addEventListener('click', loginWithGoogle);
  logoutBtn.addEventListener('click', logout);

  // Check auth state when popup opens
  checkAuthState();

  // Listen for auth state changes
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      showLoggedInState(session.user);
    } else if (event === 'SIGNED_OUT') {
      showLoginState();
      cleanupRealtimeSubscription();
      hideStickerBanner();
    }
  });
}

const testBtn = document.getElementById('testBtn');

testBtn.addEventListener('click', () => {
  console.log("Test button clicked");

  // Send a message to the content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    console.log("Right before send message")
    chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleOverlay' });
  });
});