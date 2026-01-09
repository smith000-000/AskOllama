// Content script to add a floating button over question_detail div

(function() {
  'use strict';

  let floatingButton = null;

  // Function to create and position the floating button
  function createFloatingButton() {
    const questionDetail = document.getElementById('question_detail');
    
    if (!questionDetail) {
      return; // Not on a question page
    }

    // Don't create duplicate buttons
    if (floatingButton && document.body.contains(floatingButton)) {
      return;
    }

    // Create the floating button
    floatingButton = document.createElement('button');
    floatingButton.id = 'ollama-helper-float-btn';
    floatingButton.innerHTML = '🤖';
    floatingButton.title = 'Send to Ollama Sidebar';
    
    // Style the button
    Object.assign(floatingButton.style, {
      position: 'absolute',
      bottom: '10px',
      left: '10px',
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: '2px solid #4CAF50',
      backgroundColor: 'rgba(76, 175, 80, 0.9)',
      color: 'white',
      fontSize: '20px',
      cursor: 'pointer',
      zIndex: '10000',
      boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
      transition: 'all 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0'
    });

    // Hover effect
    floatingButton.addEventListener('mouseenter', () => {
      floatingButton.style.backgroundColor = 'rgba(76, 175, 80, 1)';
      floatingButton.style.transform = 'scale(1.1)';
    });

    floatingButton.addEventListener('mouseleave', () => {
      floatingButton.style.backgroundColor = 'rgba(76, 175, 80, 0.9)';
      floatingButton.style.transform = 'scale(1)';
    });

    // Click handler
    floatingButton.addEventListener('click', async () => {
      await sendQuestionToSidebar();
    });

    // Position relative to question_detail
    questionDetail.style.position = 'relative';
    questionDetail.appendChild(floatingButton);
  }

  // Function to extract question data and send to sidebar
  async function sendQuestionToSidebar() {
    const questionDiv = document.getElementById('question_description');
    const optionsList = document.getElementById('answer_options');

    if (!questionDiv) {
      console.warn('AskOllama Extension: Could not find question_description');
      return;
    }

    const questionText = questionDiv.innerText;
    let optionsText = [];

    if (optionsList) {
      const optionElements = optionsList.querySelectorAll('li span.rr_start');
      optionsText = Array.from(optionElements).map(span => span.innerText.trim());
    }

    // Format the message
    let message = `Question:\n${questionText}`;
    
    if (optionsText.length > 0) {
      message += `\n\nAnswer Options:\n${optionsText.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}`;
    }

    // Send message to background script to open sidebar and send query
    try {
      chrome.runtime.sendMessage({
        type: 'send-to-sidebar',
        query: message
      });
    } catch (error) {
      // Handle extension context invalidation (e.g., extension was reloaded)
      if (error.message.includes('Extension context invalidated')) {
        console.log('AskOllama Extension: Extension was reloaded. Please refresh the page.');
        alert('Extension was reloaded. Please refresh this page to use the Ollama button.');
      } else {
        console.error('AskOllama Extension: Error sending message:', error);
      }
      return;
    }

    // Visual feedback
    floatingButton.innerHTML = '✓';
    floatingButton.style.backgroundColor = 'rgba(33, 150, 243, 0.9)';
    setTimeout(() => {
      floatingButton.innerHTML = '🤖';
      floatingButton.style.backgroundColor = 'rgba(76, 175, 80, 0.9)';
    }, 1000);
  }

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingButton);
  } else {
    createFloatingButton();
  }

  // Also watch for dynamic content changes
  const observer = new MutationObserver(() => {
    createFloatingButton();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Add strikethrough toggle on double-click for answer options
  document.addEventListener('dblclick', (event) => {
    const target = event.target;
    
    // Check if the double-clicked element is or is within a span.rr_start
    const rrStartSpan = target.closest('span.rr_start');
    
    if (rrStartSpan) {
      // Toggle the rr_strikeout class
      rrStartSpan.classList.toggle('rr_strikeout');
      
      // Prevent text selection on double-click
      event.preventDefault();
    }
  });
})();
